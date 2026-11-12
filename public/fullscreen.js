const fullscreenButton = document.getElementById("fullscreen-btn");

fullscreenButton.addEventListener("click", () => {
  document.documentElement.requestFullscreen();
});
