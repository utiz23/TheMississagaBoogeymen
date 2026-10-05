# Nightly database backup — see README.md in this folder.
#
# Built on the same Postgres image as the `db` service, so pg_dump/pg_restore
# always match the server version, and the image already contains a Postgres
# server for the nightly "does this backup actually restore?" test.
FROM postgres:16-alpine

RUN apk add --no-cache curl jq tzdata

COPY backup.sh scheduler.sh /usr/local/bin/
RUN chmod 755 /usr/local/bin/backup.sh /usr/local/bin/scheduler.sh

ENTRYPOINT ["/usr/local/bin/scheduler.sh"]
CMD []
