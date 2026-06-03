#!/bin/sh
set -eu

mc alias set enderchest http://minio:9000 "${MINIO_ROOT_USER}" "${MINIO_ROOT_PASSWORD}"
mc mb --ignore-existing enderchest/enderchest
