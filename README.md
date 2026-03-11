# LinkOnX.Tools.Web

`LinkOnX.Tools.Web` includes:

- `QueryDeveloper` web UI (`client`)
- API server with login and qmf file access (`server`)

## Features implemented

- Login required before qmf access
- Login uses MSSQL user table (`dbo.QSECUSRDEF`)
- Password validation follows legacy C# `QSecurity.AESEncrypte256` (`RijndaelManaged + PasswordDeriveBytes`)
- Frontend loads qmf files from server API
- qmf source text can be edited and saved back to server
- Backend qmf storage uses MSSQL table (`dbo.LinkOnX_QueryDeveloperQmf` by default)
- Query/SQL-like text blocks are auto-detected from current qmf XML

## Run

```bash
npm install
npm run install:all
npm run dev
```

- Frontend: `http://localhost:5173`
- API: `http://localhost:3001`

## Login

- Source table: `AUTH_USER_TABLE` (default `dbo.QSECUSRDEF`)
- Frontend login fields: `Factory` (required), `ID`, `Password`
- Authentication key: `FACTORY + USER_ID + PASSWORD`

## MSSQL configuration

Default development connection string:

`Data Source=192.168.0.111,1433;Initial Catalog=LINKON;User ID=linkon;Password=p@ssw0rd!2;Encrypt=False;TrustServerCertificate=True`

Configure in:

`server/.env`

Main keys:

- `MSSQL_CONNECTION_STRING=...`
- `QMF_TABLE=dbo.LinkOnX_QueryDeveloperQmf`
- `AUTH_USER_TABLE=dbo.QSECUSRDEF`
- `SECURITY_KEY=` (required, inject at runtime)
- `SECURITY_KEY_FILE=` (optional file-based secret)
- `LOGIN_RATE_LIMIT_ENABLED=` (`false` in debug, `true` in production)

On startup, backend ensures this table exists and seeds `Sample.QueryDeveloper.qmf` when empty.
