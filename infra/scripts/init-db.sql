-- EntradasYa v1 · Bases de datos para DESARROLLO LOCAL
-- Un solo servidor PostgreSQL, UNA BASE Y UN USUARIO POR SERVICIO (sección 7 del PDF).
--
-- Cómo ejecutarlo:
--   pgAdmin: conéctate como "postgres", abre Query Tool sobre la base "postgres",
--            pega este archivo y ejecútalo (F5).
--   psql:    psql -U postgres -f infra/scripts/init-db.sql
--
-- Las contraseñas coinciden con los .env.example. En el servidor, setup-server.sh
-- crea lo mismo pero con contraseñas aleatorias.
-- Si un usuario o base ya existe, ese comando dará error y puedes ignorarlo.

CREATE ROLE auth_user     LOGIN PASSWORD 'auth_dev_pass';
CREATE ROLE events_user   LOGIN PASSWORD 'events_dev_pass';
CREATE ROLE orders_user   LOGIN PASSWORD 'orders_dev_pass';
CREATE ROLE payments_user LOGIN PASSWORD 'payments_dev_pass';
CREATE ROLE tickets_user  LOGIN PASSWORD 'tickets_dev_pass';
CREATE ROLE checkin_user  LOGIN PASSWORD 'checkin_dev_pass';

CREATE DATABASE auth_db     OWNER auth_user;
CREATE DATABASE events_db   OWNER events_user;
CREATE DATABASE orders_db   OWNER orders_user;
CREATE DATABASE payments_db OWNER payments_user;
CREATE DATABASE tickets_db  OWNER tickets_user;
CREATE DATABASE checkin_db  OWNER checkin_user;

-- Cada servicio solo puede entrar a SU base (nunca lee la de otro).
REVOKE CONNECT ON DATABASE auth_db, events_db, orders_db, payments_db, tickets_db, checkin_db FROM PUBLIC;
GRANT CONNECT ON DATABASE auth_db     TO auth_user;
GRANT CONNECT ON DATABASE events_db   TO events_user;
GRANT CONNECT ON DATABASE orders_db   TO orders_user;
GRANT CONNECT ON DATABASE payments_db TO payments_user;
GRANT CONNECT ON DATABASE tickets_db  TO tickets_user;
GRANT CONNECT ON DATABASE checkin_db  TO checkin_user;

-- notifications y web no tienen base de datos.
