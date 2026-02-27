# Floppy Bird × StarkZap Payment

This example forks [nebez/floppybird](https://github.com/nebez/floppybird) and adds a Save Me payment flow using `starkzap.payment.modal(...).pay()`.

## Run locally

```bash
cd examples/flappy-bird
npm install
npm run dev
```

Open the URL shown in the terminal (for example `http://localhost:5173`), then play as normal.

When the run ends, use **Save me · $0.10** to open a payment session. A successful payment revives the current run.

## Configure payment


Set `VITE_CHAINRAILS_SESSION_URL` to point at your payment session endpoint.

If not provided, the app uses:

`http://localhost:3001/session-token`

## Notes

- Game engine and assets remain from the original Floppy Bird project.
- Payment flow is wired in `main.ts` and consumed from `public/js/main.js` through a global callback hook.
