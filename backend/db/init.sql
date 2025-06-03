-- Create the user if not exists
DO
$do$
BEGIN
   IF NOT EXISTS (
      SELECT FROM pg_catalog.pg_roles
      WHERE  rolname = 'mytube') THEN
      CREATE USER mytube WITH PASSWORD '123456';
   END IF;
END
$do$;

-- Create the database if not exists
SELECT 'CREATE DATABASE mytube'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'mytube')\gexec

-- Grant all privileges on the database to the user
GRANT ALL PRIVILEGES ON DATABASE mytube TO mytube;

-- Connect to the mytube database
\c mytube

-- Grant all privileges on the schema to the user
GRANT ALL PRIVILEGES ON SCHEMA public TO mytube;

-- Grant all privileges on all tables to the user
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO mytube;

-- Grant all privileges on all sequences to the user
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO mytube;

-- Make mytube the owner of the public schema
ALTER SCHEMA public OWNER TO mytube; 