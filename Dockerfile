###################
# STAGE 1: Builder
###################

# Use the official Node.js 18 image as the base for building
FROM node:18-bullseye AS builder

# Define build-time arguments
ARG MB_EDITION=oss
ARG VERSION=latest

# Set the working directory inside the container
WORKDIR /home/node

# Install necessary packages and Clojure
RUN apt-get update && \
    apt-get upgrade -y && \
    apt-get install -y openjdk-11-jdk curl git && \
    curl -O https://download.clojure.org/install/linux-install-1.11.1.1262.sh && \
    chmod +x linux-install-1.11.1.1262.sh && \
    ./linux-install-1.11.1.1262.sh && \
    rm linux-install-1.11.1.1262.sh

# Copy package.json and yarn.lock first for better caching
COPY package.json yarn.lock ./

# Install frontend dependencies using Yarn
RUN yarn install

# Initialize Husky (hooks will be installed via the prepare script)
RUN yarn prepare

# (Optional) Add Git hooks if you have predefined hooks
# For example, adding a pre-commit hook:
# RUN npx husky add .husky/pre-commit "yarn lint-staged"

# Copy the rest of the project into the container
COPY . .

# Configure Git to recognize the working directory as safe
RUN git config --global --add safe.directory /home/node

# Build the Metabase application
RUN INTERACTIVE=false CI=true MB_EDITION=$MB_EDITION bin/build.sh :version ${VERSION}

###################
# STAGE 2: Runner
###################

# Use Eclipse Temurin JRE 11 on Alpine Linux for a lightweight runtime
FROM openjdk:19-buster AS runner

# Set environment variables for localization and Metabase configurations
ENV FC_LANG=en-US \
    LC_CTYPE=en_US.UTF-8 \
    MB_PLUGINS_DIR=/app/plugins/ \
    MB_DB_TYPE=h2 \
    MB_DB_FILE=/data/metabase/metabase.db

# Install runtime dependencies and configure Java CA certificates
RUN mkdir -p /app/plugins && \
    chmod a+rwx /app/plugins

# Copy the built Metabase JAR from the builder stage
COPY --from=builder /home/node/target/uberjar/metabase.jar /app/

# Copy the Metabase startup script
COPY bin/docker/run_metabase.sh /app/

# Add the DuckDB Metabase driver plugin
ADD https://github.com/MotherDuck-Open-Source/metabase_duckdb_driver/releases/download/0.2.10/duckdb.metabase-driver.jar /app/plugins/
RUN chmod 744 /app/plugins/duckdb.metabase-driver.jar

# Create the data directory for Metabase database
RUN mkdir -p /data/metabase

# Expose the default Metabase port
EXPOSE 3000

# Set the entrypoint to the Metabase startup script
ENTRYPOINT ["/app/run_metabase.sh"]
