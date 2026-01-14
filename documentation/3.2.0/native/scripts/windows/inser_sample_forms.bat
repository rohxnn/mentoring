set PGPASSWORD=postgres

psql -p 5432 -U postgres -d mentoring -f insert_form.sql

set PGPASSWORD=