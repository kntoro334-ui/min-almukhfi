# Secret Identity 🎭 — Production

## Local test
```bash
npm install
npm start
```
Open http://localhost:3000

## Deploy to Render
1. Create a GitHub repository and upload the contents of this project.
2. On Render, choose New → Web Service.
3. Connect the GitHub repository.
4. Build Command: `npm install`
5. Start Command: `npm start`
6. Deploy.
7. Open the generated `https://...onrender.com` URL.

The server listens on `process.env.PORT` and `0.0.0.0`, which is required by typical cloud web-service hosting.

## Important
The current room state is stored in server memory (`rooms = {}`). A server restart clears active rooms.
For larger-scale multi-instance deployment, add Redis/Socket.IO adapter later.
