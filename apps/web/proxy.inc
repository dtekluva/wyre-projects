proxy_http_version 1.1;
proxy_set_header Host $host;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
# Django reads this to know the original request was https (SECURE_PROXY_SSL_HEADER)
proxy_set_header X-Forwarded-Proto $http_x_forwarded_proto;
proxy_read_timeout 90s;
