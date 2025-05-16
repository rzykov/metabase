###################
# STAGE 1: builder
###################

FROM node:22 as builder

ARG MB_EDITION=oss
ARG VERSION=latest

WORKDIR /home/node

RUN apt-get update && apt-get upgrade -y && apt-get install wget apt-transport-https gpg curl git -y \
    && wget -qO - https://packages.adoptium.net/artifactory/api/gpg/key/public | gpg --dearmor | tee /etc/apt/trusted.gpg.d/adoptium.gpg > /dev/null \
    && echo "deb https://packages.adoptium.net/artifactory/deb $(awk -F= '/^VERSION_CODENAME/{print$2}' /etc/os-release) main" | tee /etc/apt/sources.list.d/adoptium.list \
    && apt-get update \
    && apt install temurin-21-jdk -y \
    && curl -O https://download.clojure.org/install/linux-install-1.12.0.1488.sh \
    && chmod +x linux-install-1.12.0.1488.sh \
    && ./linux-install-1.12.0.1488.sh

COPY . .

# version is pulled from git, but git doesn't trust the directory due to different owners
RUN git config --global --add safe.directory /home/node

# install frontend dependencies
RUN yarn --frozen-lockfile

RUN INTERACTIVE=false CI=true MB_EDITION=$MB_EDITION bin/build.sh :version ${VERSION}

# ###################
# # STAGE 2: runner
# ###################

## Remember that this runner image needs to be the same as bin/docker/Dockerfile with the exception that this one grabs the
## jar from the previous stage rather than the local build
## we're not yet there to provide an ARM runner till https://github.com/adoptium/adoptium/issues/96 is ready

FROM eclipse-temurin:21-jre as runner

ENV FC_LANG=en-US \
    LC_CTYPE=en_US.UTF-8 \
    MB_PLUGINS_DIR=/app/plugins/ \
    MB_DB_TYPE=h2 \
    MB_DB_FILE=/data/metabase/metabase.db

# dependencies
RUN apt-get update && \
    apt-get install -y \
        bash \
        curl \
        ca-certificates \
        fontconfig \
        fonts-noto \
        fonts-noto-cjk \
        fonts-noto-color-emoji \
        libstdc++6 && \
    rm -rf /var/lib/apt/lists/* && \
    mkdir -p /app/certs && \
    curl https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem -o /app/certs/rds-combined-ca-bundle.pem  && \
    keytool -noprompt -import -trustcacerts -alias aws-rds -file /app/certs/rds-combined-ca-bundle.pem -keystore /etc/ssl/certs/java/cacerts -keypass changeit -storepass changeit && \
    curl https://cacerts.digicert.com/DigiCertGlobalRootG2.crt.pem -o /app/certs/DigiCertGlobalRootG2.crt.pem  && \
    keytool -noprompt -import -trustcacerts -alias azure-cert -file /app/certs/DigiCertGlobalRootG2.crt.pem -keystore /etc/ssl/certs/java/cacerts -keypass changeit -storepass changeit


RUN mkdir -p /app/plugins /data/metabase && chmod -R a+rwx /app/plugins

COPY duckdb.metabase-driver.jar /app/plugins/
RUN chmod 744 /app/plugins/duckdb.metabase-driver.jar

COPY --from=builder /home/node/target/uberjar/metabase.jar /app/
COPY bin/docker/run_metabase.sh /app/

# expose our default runtime port
EXPOSE 3000

# run it
ENTRYPOINT ["/app/run_metabase.sh"]