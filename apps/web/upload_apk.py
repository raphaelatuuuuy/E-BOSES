import hashlib
import os
import platform
import subprocess
import sys
from pathlib import Path
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload

SCOPES = ["https://www.googleapis.com/auth/drive"]
ROOT = Path(__file__).resolve().parent.parent.parent
WEB_DIR = ROOT / "apps" / "web"
ANDROID_DIR = WEB_DIR / "android"
CREDENTIALS_FILE = ROOT / "credentials.json"
TOKEN_FILE = ROOT / "token.json"
FOLDER_ID = "1YxTsJzBHZ2Hbd1TdBqvxLF4DsoQY5s8g"
FILE_NAME = "E-Boses.apk"
IS_WINDOWS = platform.system() == "Windows"

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
    link = upload_apk(apk)
    print(f"\nUpdate constants.ts with: {link}")
