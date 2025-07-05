#!/bin/bash


# The actual MinIO command
#
#
export MINIO_ROOT_USER=admin
export MINIO_ROOT_PASSWORD=thisisgoodpassword
/usr/local/bin/minio server /home/liang/minio_data --address ":9200" --console-address ":9201"
