const connection = document.createElement("div");
connection.id = "connection-notice";
connection.textContent = "Connection lost, reconnecting...";
connection.hidden = true;
document.body.appendChild(connection);

socket.on("disconnect", () => {
  connection.hidden = false;
});

socket.on("connect", () => {
  connection.hidden = true;
});
