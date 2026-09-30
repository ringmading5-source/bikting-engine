# Deploy this folder on Render

Create a **new Web Service** from `ringmading5-source/bikting-engine`.

| Setting | Value |
|---|---|
| Branch | `main` |
| Root Directory | `b-stae` |
| Language | Python 3 |
| Build Command | `python -m unittest discover -s tests -q` |
| Start Command | `python app.py --host 0.0.0.0` |
| Health Check Path | `/health` |
| Environment variable | `BSTAE_ACCESS_TOKEN`: your own random secret, at least 16 characters |

Render sets PORT and RENDER_EXTERNAL_HOSTNAME automatically. The app uses them. Enter your secret in the page's **Access token** input; it is used for API access and is not stored by the browser. No LLM key is required. Generate a secret locally with `python -c "import secrets; print(secrets.token_urlsafe(32))"`. Keep it in Render's Environment settings, never in GitHub.

Alternatively create a Blueprint and specify **Blueprint Path** `b-stae/render.yaml`. Do not select the root `render.yaml`, which belongs to the existing Node Bikting service.

This configuration is a free prototype service using SQLite. Its memory is ephemeral on a free service: redeploys/restarts can lose observations and paths. To preserve memory, use a paid service, attach a persistent disk at `/var/data`, and set `BSTAE_DB_PATH=/var/data/knowledge.sqlite3`. This app uses one SQLite database and serves requests serially; it is not a multi-user production deployment.

After deployment:

1. Open the generated Render URL.
2. Enter your access token.
3. Click **Load example observations**.
4. Try text `New` or color `#102030`.

The push prepares deployment; it does not create or deploy the Render service.

Official references: https://render.com/docs/web-services and https://render.com/docs/disks.
