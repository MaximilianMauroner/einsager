# Security

einsager is an alpha. Only the latest release receives fixes.

## Report a problem

Do not open a public issue for a security problem. Report it privately: open
the repository's **Security** tab and click **Report a vulnerability**.

Include the einsager version, your system, and the steps that show the
problem. You get an answer in the advisory.

## What matters most

einsager sends recordings to OpenAI with an API key or, after explicit consent,
the ChatGPT login that Codex stores on your computer. Problems that can expose
API keys, login tokens, audio, transcripts, or the clipboard are the most important.

Do not include an API key, `auth.json`, or private audio in a report. If a key
is exposed, revoke it on the [OpenAI API keys page](https://platform.openai.com/api-keys).
Removing a key from einsager deletes the local copy. It does not revoke the key.
