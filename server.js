const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

let globalState = {};

io.on('connection', (socket) => {
  socket.emit('init_data', globalState);

  socket.on('tank_changed', (data) => {
    const { tankNo } = data;
    globalState[tankNo] = data; 
    socket.broadcast.emit('sync_tank', data);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 雲端伺服器啟動！`);
});
