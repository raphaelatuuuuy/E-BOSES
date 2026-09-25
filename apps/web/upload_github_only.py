import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from upload_apk import find_apk, upload_to_github_releases

apk = find_apk()
print(f"Found APK: {apk}")
link = upload_to_github_releases(apk)
print(f"GitHub Release URL: {link}")
