## Umiji Backend

The API, workers and scheduler of the [Umiji](https://github.com/therewasluna/umiji) panel.

- [DEPLOY.md](DEPLOY.md): run Umiji on your own server
- [DEVELOPMENT.md](DEVELOPMENT.md): run it locally
- [docs/BROKERS.md](docs/BROKERS.md): reseller accounts and their Telegram store bots

`APP_SECRET` must be at least 32 characters. Resetting a broker password revokes its existing
sessions; brokers can still use password sign-in when owner password sign-in is disabled.

## License

AGPL-3.0, see [LICENCE](LICENCE). Umiji is a modified version of Remnawave.
