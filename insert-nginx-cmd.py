#!/usr/bin/env python3
import sys

nginx_file = '/etc/nginx/sites-enabled/websip58k.new.back'
snippet_file = '/home/egan/nginx-cmd-snippet.conf'

with open(nginx_file, 'r') as f:
    content = f.read()

with open(snippet_file, 'r') as f:
    snippet = f.read()

last_brace = content.rfind('}')
new_content = content[:last_brace] + snippet + '\n' + content[last_brace:]

with open(nginx_file, 'w') as f:
    f.write(new_content)

print('Nginx config updated successfully')
