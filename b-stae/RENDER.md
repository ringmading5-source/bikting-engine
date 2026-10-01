# Deploy the Python knowledge and procedure service

Use repository ringmading5-source/bikting-engine with root directory b-stae,
Python 3, build command `pip install -r requirements.txt && python -m unittest discover -s tests -q`,
start command `python app.py --host 0.0.0.0`, and health check /health.
Configure BSTAE_ACCESS_TOKEN as a random secret of at least 16 characters.
Render supplies PORT and RENDER_EXTERNAL_HOSTNAME. Enter the token in the page;
the browser does not persist it. No LLM key is required for this Python service.
The Node service has separate Gemini and memory API configuration.

Use b-stae/render.yaml for a Blueprint. Persistent storage needs a mounted disk
and BSTAE_DB_PATH pointing to its SQLite file. Without persistent storage,
redeployment can lose knowledge and stored paths. This is a single-process
prototype, not a multi-user production deployment.

After deployment, use Source-backed knowledge to retrieve evidence. In Explicit
procedure, enter a JSON value, a supported operation such as add 2, and a source
reference; store it and execute it. Stored composition accepts explicit phrase
intents or registered child phrases. There are no training or prediction controls.

Code publication alone does not deploy a Render service.

## Optional Gemini interpreter

Set `GEMINI_API_KEY` in the **Python B-STAE service** Environment settings,
then save and redeploy. A key on the separate Node service is not shared.
`GEMINI_MODEL` defaults to `gemini-2.5-flash` and can be changed server-side.
Never paste a key into chat, the request editor, source code, or browser storage.
Use “Check connection setup”, then “Preview operation” in the Gemini panel.
Configuration status only confirms a key exists; a preview verifies actual access.

The adapter uses one model call (20-second timeout, 512 output tokens, no retries)
to propose a single supported operation. Known operation syntax stays local.
Only request text and representation metadata are sent, not the current payload.
Malformed, truncated, unsupported or incompatible proposals stop. B-STAE verifies
the chosen transformation; this does not prove Gemini interpreted the user correctly.
Speech transcription, image understanding and arbitrary tool/code execution are
not added by this adapter. Gemini requests consume your API quota.
