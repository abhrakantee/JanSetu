"""Local zero-dependency structural smoke tests. Run: python tests/smoke_test.py
These do not replace a live end-to-end Supabase integration test.
"""
from pathlib import Path
from html.parser import HTMLParser
import json, subprocess, re

root = Path(__file__).resolve().parents[1]
class Scanner(HTMLParser):
    def __init__(self):
        super().__init__();self.ids=[];self.assets=[]
    def handle_starttag(self, tag, attributes):
        attrs=dict(attributes)
        if 'id' in attrs: self.ids.append(attrs['id'])
        for key in ['src','href']:
            if attrs.get(key,'').startswith('assets/'):
                self.assets.append(attrs[key])

html = (root/'index.html').read_text(encoding='utf-8')
script = (root/'app.js').read_text(encoding='utf-8')
styles = (root/'style.css').read_text(encoding='utf-8')
schema = (root/'supabase/schema.sql').read_text(encoding='utf-8')
scanner=Scanner();scanner.feed(html)
assert len(scanner.ids) == len(set(scanner.ids)), 'Duplicate HTML ids found'
for asset in scanner.assets: assert (root/asset).is_file(),f'Missing asset {asset}'
for required in ['authScreen','appShell','reportForm','cameraInput','galleryInput','useLocation','exploreMap','profileForm','notificationList','passwordDialog']:
    assert required in scanner.ids, f'Missing UI node {required}'
assert 'Made by Abhrakantee Sarkar' in html
assert 'your_client_secret' not in html and 'AIzaSy' not in html
assert 'localStorage.setItem("jansetuReports"' not in script
assert 'getCurrentPosition' in script and 'signInWithOAuth' in script and 'signInWithOtp' in script
assert 'row level security' in schema.lower() and 'report_feed' in schema
assert (root/'config.js').is_file()
json.loads((root/'manifest.webmanifest').read_text())
json.loads((root/'vercel.json').read_text())
subprocess.run(['node','--check',str(root/'app.js')],check=True)
subprocess.run(['node','--check',str(root/'sw.js')],check=True)
print('PASS: HTML ids/assets, auth-first UI, upload/GPS handlers, SQL, manifest, JS syntax')
print('NOTE: Configure Supabase and verify real login, email, SMS, image upload, and policies before launch.')
