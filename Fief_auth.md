# Open source authorisation for Metabase

Based on fief (https://docs.fief.dev).

## Problem
My pet project (corpsignals.com) needed a sharable user registration service, which can be used by multiple applications.
Also, I use Metabase for analytics. I wanted to use the same user registration service for Metabase.
Metabase supports LDAP, Google OAuth and Email. Enterprise version of Metabase supports SAML and JWT (SSO).
But the Enteprise verison is an overkill for my use case. I wanted to use my own user registration service.

## Solution
I have to modify the Metabase source code to add the fief authorisation mechanism for my pet project. As a base auth service
I used the fief (https://docs.fief.dev) service (open source). I have to modify the Metabase source code to add the fief authorisation mechanism.

How it works:
1. A user goes to the Metabase login page (app.corpsignals.com).
2. The user clicks the SignIn/SignUp button, or he will be redirected after 5 seconds automatically.
3. The fief will ask a user to register. After registration, the user will be redirected to the Metabase.
4. If a user comes to the specific Metabase page, he will be redirected to it after log in.
5. A user can't modify his profile in Metabase.
6. When a user clicks the logout button, he will be log outed from the fief too. And redirected to the specific page.

Video demo: https://www.youtube.com/watch?v=5Q6J9Q6Q9ZQ


## Steps
1. Clone the Metabase source code from this branch
2. Modify the Metabase source code:
    * Change a domain where a user will be redirected after logout here https://github.com/rzykov/metabase/blob/fiev_auth/frontend/src/metabase/auth/actions.ts#L146
    * Change to the fief's subdomain here https://github.com/rzykov/metabase/blob/fiev_auth/src/metabase/integrations/google.clj#L75
    * Find corpsignals (remove retenly lines too) domain and replace it with your fief subdomain here: https://github.com/rzykov/metabase/blob/fiev_auth/src/metabase/server/middleware/security.clj
3. Build Metabase with a command. Read the Metabase documentation to get more information.:
```
DOCKER_BUILDKIT=1 docker build -t metabase_fief .
```
4. Create or modify a docker compose file. If you need any help, read the instruction of Metabase and Fief. This is my docker-compose file:
```
  proxy:
    build:
      context: ./nginx
      dockerfile: Dockerfile
    container_name: proxy
    volumes:
      - ./nginx/html:/var/www/html:ro
    ports:
      - "80:80"
      - "443:443"
    depends_on:
      - metabase_demo
      - fief_server


  metabase_demo:
    image: metabase_fief:latest
    container_name: metabase_demo
    ports:
      - "3001:3000"
    env_file:
      - .env_docker_metabase_demo
    volumes:
      - [your path to the metabase main database]:/data/metabase_demo
    deploy:
      resources:
        limits:
          memory: 5GB

  fief_server:
    image: ghcr.io/fief-dev/fief:latest
    command: fief run-server
    ports:
      - "8000:8000"
    env_file:
      - .env_fief
    volumes:
      - /opt/data/fief:/data
    depends_on:
      - redis

  redis:
    image: redis:alpine
    command: redis-server --save 60 1 --loglevel warning
    volumes:
      - /opt/data/fief:/data

  fief_worker:
    image: ghcr.io/fief-dev/fief:latest
    command: fief run-worker -p 1 -t 1
    env_file:
      - .env_fief
    volumes:
      - /opt/data/fief:/data
    depends_on:
      - redis
```
5. Create or edit nginx configuration file. This is a part of my configuration file:
```
http {
    include /etc/nginx/mime.types;
    default_type  application/octet-stream;

    log_format timed_combined '$remote_addr - $remote_user [$time_local] '
                          '"$request" $status $body_bytes_sent '
                          '"$http_referer" "$http_user_agent" "$http_x_forwarded_for" '
                          '$request_time';

    access_log  /var/log/nginx/access.log  timed_combined;

    sendfile        on;
    server_tokens off;

    keepalive_timeout  180;
    proxy_connect_timeout       180;
    proxy_send_timeout          180;
    proxy_read_timeout          180;
    send_timeout                180;

    gzip  on;

    server {
        listen 443 ssl http2;
        listen [::]:443 ssl http2;
        server_name app.corpsignals.com;

        gzip off;

        ssl_certificate /etc/nginx/cert_corpsignals.pem;
        ssl_certificate_key /etc/nginx/key_corpsignals.pem;


        location / {
            proxy_pass http://metabase_demo:3000;
            proxy_set_header Accept-Encoding "";
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }

        error_page 404 /404.html;
        error_page 500 502 503 504 /50x.html;
    }


    server {
        listen 443 ssl http2;
        listen [::]:443 ssl http2;
        server_name auth.corpsignals.com;

        gzip off;

        ssl_certificate /etc/nginx/cert_corpsignals.pem;
        ssl_certificate_key /etc/nginx/key_corpsignals.pem;


        location / {
            proxy_pass http://fief_server:8000;
            proxy_set_header Accept-Encoding "";
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }

        error_page 404 /404.html;
        error_page 500 502 503 504 /50x.html;
    }

    server {
        listen 80;
        listen [::]:80;
        server_name corpsignals.com www.corpsignals.com;

        # Redirect all HTTP requests to HTTPS
        return 301 https://$host$request_uri;
    }


}
```
6. Add the following environment variables to the .env_fief file:
```
ENVIRONMENT=production

SECRET=[read fief documentation to set it]
FIEF_CLIENT_ID=[read fief documentation to set it]
FIEF_CLIENT_SECRET=[read fief documentation to set it]
ENCRYPTION_KEY=[read fief documentation to set it]
PORT=8000

FIEF_DOMAIN=[you subdomain for fief]


# Set your email address here
FIEF_MAIN_USER_EMAIL=[admin user email]
FIEF_MAIN_USER_PASSWORD=[admin user password. you'll be asked to change it]

# Read more: https://docs.fief.dev/self-hosting/configuration/database/
DATABASE_LOCATION=/data

# Read more: https://docs.fief.dev/self-hosting/environment-variables/#redis
REDIS_URL=redis://redis:6379

# Read more: https://docs.fief.dev/self-hosting/configuration/ssl/
FORWARDED_ALLOW_IPS=[read fief documentation to set it]
CSRF_COOKIE_SECURE=True
LOGIN_SESSION_COOKIE_SECURE=True
SESSION_COOKIE_SECURE=True
FIEF_ADMIN_SESSION_COOKIE_SECURE=True
ALLOW_ORIGIN_REGEX=https://.*\.[your domain]
```
7. Run Fief service and create a new client Metabase inside it. It provides you a Client ID.
8. Add the following environment variables to the .env_docker_metabase_demo file:
```
MB_DB_TYPE=h2
MB_DB_FILE=/data/metabase_demo/metabase.db
MB_REDIRECT_ALL_REQUESTS_TO_HTTPS=false
# I use old Google environments variable to store the data for fief now.
# Skip those two line for the first run
MB_GOOGLE_AUTH_CLIENT_ID=[use client id from previous step].[fief subdomain]
MB_GOOGLE_AUTH_ENABLED=true
```
9. Drink a cup of coffee and enjoy your new Metabase with fief authorisation.

## Responsibility
I'm not responsible for any damage or loss of data. Use it at your own risk.
The code will be modified in the future. I'm not going to support it. It's just a proof of concept.
