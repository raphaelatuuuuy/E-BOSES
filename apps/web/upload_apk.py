import hashlib
import os
import platform
import re
import shutil
import subprocess
import sys
from pathlib import Path
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload

import requests

SCOPES = ["https://www.googleapis.com/auth/drive"]
ROOT = Path(__file__).resolve().parent.parent.parent
WEB_DIR = ROOT / "apps" / "web"
ANDROID_DIR = WEB_DIR / "android"
CREDENTIALS_FILE = ROOT / "credentials.json"
TOKEN_FILE = ROOT / "token.json"
FOLDER_ID = "1YxTsJzBHZ2Hbd1TdBqvxLF4DsoQY5s8g"
FILE_NAME = "E-Boses.apk"
IS_WINDOWS = platform.system() == "Windows"
NATIVE_PUBLIC_DIR = ANDROID_DIR / "app" / "src" / "main" / "assets" / "public"
CAPACITOR_ASSETS = {"cordova.js", "cordova_plugins.js"}

GITHUB_TOKEN = os.environ.get("GITHUB_TOKEN", "")
GITHUB_OWNER = "raphaelatuuuuy"
GITHUB_REPO = "E-BOSES"
GITHUB_TAG = "v1"

NPM = "npm.cmd" if IS_WINDOWS else "npm"
NPX = "npx.cmd" if IS_WINDOWS else "npx"


def run(cmd, cwd=None):
    print(f"\n>>> {' '.join(cmd)}")
    env = os.environ.copy()
    if IS_WINDOWS:
        npm_dir = os.path.join(os.environ.get("APPDATA", ""), "npm")
        if os.path.isdir(npm_dir) and npm_dir not in env["PATH"]:
            env["PATH"] = npm_dir + ";" + env["PATH"]
    result = subprocess.run(cmd, cwd=cwd, shell=False, env=env)
    if result.returncode != 0:
        print(f"!!! Command failed with code {result.returncode}")
        sys.exit(1)


def build_apk():
    print("=" * 60)
    print("Step 1: Build web app")
    print("=" * 60)
    run([NPM, "run", "build:native"], cwd=str(WEB_DIR))

    print("\n" + "=" * 60)
    print("Step 2: Sync Android project")
    print("=" * 60)
    run([NPX, "cap", "sync", "android"], cwd=str(WEB_DIR))
    sync_native_web_assets()
    verify_native_web_assets()
    verify_native_sms_plugin()

    print("\n" + "=" * 60)
    print("Step 3: Build APK")
    print("=" * 60)
    gradlew = ANDROID_DIR / "gradlew"
    if IS_WINDOWS:
        gradlew = str(gradlew) + ".bat"
    run([str(gradlew), "assembleDebug"], cwd=str(ANDROID_DIR))


def find_apk():
    apk = ANDROID_DIR / "app" / "build" / "outputs" / "apk" / "debug" / "app-debug.apk"
    if not apk.is_file():
        raise FileNotFoundError(apk)
    return apk


def sync_native_web_assets():
    source_dir = WEB_DIR / "dist-native"
    if not source_dir.is_dir():
        raise FileNotFoundError(source_dir)

    NATIVE_PUBLIC_DIR.mkdir(parents=True, exist_ok=True)
    for child in NATIVE_PUBLIC_DIR.iterdir():
        if child.name in CAPACITOR_ASSETS:
            continue
        if child.is_dir():
            shutil.rmtree(child)
        else:
            child.unlink()

    for child in source_dir.iterdir():
        destination = NATIVE_PUBLIC_DIR / child.name
        if child.is_dir():
            shutil.copytree(child, destination)
        else:
            shutil.copy2(child, destination)


def file_hash(path, algorithm):
    with path.open("rb") as source:
        return hashlib.file_digest(source, algorithm).hexdigest()


def verify_native_web_assets():
    source_dir = WEB_DIR / "dist-native"
    missing = []
    mismatched = []
    for source in source_dir.rglob("*"):
        if not source.is_file():
            continue
        destination = NATIVE_PUBLIC_DIR / source.relative_to(source_dir)
        if not destination.is_file():
            missing.append(str(destination.relative_to(ANDROID_DIR)))
            continue
        if file_hash(source, "sha256") != file_hash(destination, "sha256"):
            mismatched.append(str(destination.relative_to(ANDROID_DIR)))

    if missing or mismatched:
        details = []
        if missing:
            details.append(f"missing={missing[:10]}")
        if mismatched:
            details.append(f"mismatched={mismatched[:10]}")
        raise RuntimeError("Native web bundle verification failed: " + "; ".join(details))

    stale = [
        str(path.relative_to(NATIVE_PUBLIC_DIR))
        for path in NATIVE_PUBLIC_DIR.rglob("*")
        if path.is_file()
        and path.name not in CAPACITOR_ASSETS
        and not (source_dir / path.relative_to(NATIVE_PUBLIC_DIR)).is_file()
    ]
    if stale:
        raise RuntimeError(f"Stale native web assets remain: {stale[:10]}")

    print(f"Verified native web bundle sync: {source_dir} -> {NATIVE_PUBLIC_DIR}")


def verify_native_sms_plugin():
    plugin = ANDROID_DIR / "app" / "src" / "main" / "java" / "com" / "eboses" / "app" / "SmsInboxPlugin.java"
    activity = ANDROID_DIR / "app" / "src" / "main" / "java" / "com" / "eboses" / "app" / "MainActivity.java"
    if not plugin.is_file() or "void sendSms(PluginCall call)" not in plugin.read_text(encoding="utf-8"):
        raise RuntimeError("SmsInboxPlugin.sendSms is missing from the Android project")
    if not activity.is_file() or "registerPlugin(SmsInboxPlugin.class)" not in activity.read_text(encoding="utf-8"):
        raise RuntimeError("SmsInboxPlugin is not registered in MainActivity")
    print("Verified native SMS plugin registration and outbound SMS capability")


def get_credentials():
    creds = None
    if os.path.exists(TOKEN_FILE):
        creds = Credentials.from_authorized_user_file(TOKEN_FILE, SCOPES)
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            flow = InstalledAppFlow.from_client_secrets_file(str(CREDENTIALS_FILE), SCOPES)
            creds = flow.run_local_server(port=0)
        with open(TOKEN_FILE, "w") as f:
            f.write(creds.to_json())
    return creds


def github_headers():
    if not GITHUB_TOKEN:
        raise RuntimeError(
            "GITHUB_TOKEN not set.\n"
            "Set it as an environment variable before running:\n"
            f"  Windows: set GITHUB_TOKEN={GITHUB_TOKEN or '<your-token>'}\n"
            f"  Mac/Linux: export GITHUB_TOKEN=<your-token>"
        )
    return {
        "Authorization": f"Bearer {GITHUB_TOKEN}",
        "Accept": "application/vnd.github+json",
    }


def upload_to_github_releases(apk_path):
    print("=" * 60)
    print("Step 4: Upload to GitHub Releases")
    print("=" * 60)
    headers = github_headers()

    release_id = None
    r = requests.get(
        f"https://api.github.com/repos/{GITHUB_OWNER}/{GITHUB_REPO}/releases/tags/{GITHUB_TAG}",
        headers=headers,
    )
    if r.status_code == 200:
        release = r.json()
        release_id = release.get("id")
        print(f"Existing release found: {release.get('html_url')}")

    if release_id:
        print(f"Deleting existing release {release_id}...")
        r = requests.delete(
            f"https://api.github.com/repos/{GITHUB_OWNER}/{GITHUB_REPO}/releases/{release_id}",
            headers=headers,
        )
        if r.status_code not in (204,):
            raise RuntimeError(f"Failed to delete release: {r.status_code} {r.text}")
        print("Release deleted.")

    print(f"Creating release {GITHUB_TAG}...")
    r = requests.post(
        f"https://api.github.com/repos/{GITHUB_OWNER}/{GITHUB_REPO}/releases",
        headers=headers,
        json={
            "tag_name": GITHUB_TAG,
            "name": f"E-Boses {GITHUB_TAG}",
            "draft": False,
            "prerelease": False,
        },
    )
    if r.status_code not in (201,):
        raise RuntimeError(f"Failed to create release: {r.status_code} {r.text}")
    release = r.json()
    print(f"Release created: {release.get('html_url')}")

    upload_url = release.get("upload_url", "")
    if not upload_url:
        raise RuntimeError("No upload_url in release response")
    upload_url = re.sub(r"\{[^}]*\}", "", upload_url)

    print(f"Uploading {FILE_NAME}...")
    with open(apk_path, "rb") as f:
        file_data = f.read()

    r = requests.post(
        upload_url,
        params={"name": FILE_NAME},
        headers={
            "Authorization": f"Bearer {GITHUB_TOKEN}",
        },
        files={"file": (FILE_NAME, file_data, "application/octet-stream")},
    )

    if r.status_code not in (201, 202):
        raise RuntimeError(f"Upload failed: {r.status_code} {r.text[:500]}")

    download_url = f"https://github.com/{GITHUB_OWNER}/{GITHUB_REPO}/releases/download/{GITHUB_TAG}/{FILE_NAME}"
    print(f"Uploaded: {download_url}")
    return download_url


def upload_apk(apk_path):
    print("\n" + "=" * 60)
    print("Step 4: Upload to Google Drive")
    print("=" * 60)
    creds = get_credentials()
    service = build("drive", "v3", credentials=creds)

    file_id = "1asRwyikXlhlk-n0svrvmoTqc6sY7D9rI"
    metadata = service.files().get(fileId=file_id, fields="id,name,trashed").execute()
    if metadata.get("trashed") or metadata["name"] != FILE_NAME:
        raise RuntimeError("The linked Drive file is not the expected APK")
    with open(apk_path, "rb") as source:
        checksum = hashlib.file_digest(source, "md5").hexdigest()
    media = MediaFileUpload(str(apk_path), mimetype="application/vnd.android.package-archive", resumable=True)
    service.files().update(fileId=file_id, media_body=media).execute()
    file = service.files().get(
        fileId=file_id,
        fields="id,name,size,md5Checksum,modifiedTime,webViewLink",
    ).execute()
    if int(file["size"]) != apk_path.stat().st_size or file["md5Checksum"] != checksum:
        raise RuntimeError("Drive APK verification failed")
    link = file["webViewLink"]
    print(f"Verified Drive APK: {file['size']} bytes, MD5 {checksum}, updated {file['modifiedTime']}")
    print(f"\nUploaded: {link}")
    return link


if __name__ == "__main__":
    build_apk()
    apk = find_apk()
    print(f"\nFound APK: {apk}")
    link = upload_to_github_releases(apk)
    print(f"\nUpdate constants.ts with: {link}")
