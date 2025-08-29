// server.js
require('dotenv').config();
const path = require('path');
const express = require('express');
const morgan = require('morgan');
const { getContext } = require('./context');

const app = express();
const PORT = Number(process.env.PORT || 3000);

app.use(express.json());
app.use(morgan('tiny'));
app.use(express.static(path.join(__dirname, 'public')));

// Mount per-site routes (absolute paths to avoid cwd issues)
app.use('/storage', express.static(path.join(__dirname, 'storage')));   // Site 1: AliExpress
require(path.join(__dirname, 'routes', 'ali'))(app);   // Site 1: AliExpress
require(path.join(__dirname, 'routes', 'yodo'))(app);  // Site 2: Yodobashi
// Site 3: BigCamera
require(path.join(__dirname, 'routes', 'big'))(app);
// server.js
require(path.join(__dirname, 'routes', 'yodo_schedule'))(app);  // Site 2: scheduler


app.listen(PORT, async () => {
  await getContext();
  console.log(`Server listening on http://localhost:${PORT}`);
});

module.exports = app;
