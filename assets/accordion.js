(function(){
  function toggle(btn){
    const panel = btn.parentElement.querySelector('.acc-panel');
    const isOpen = panel.classList.contains('open');
    panel.classList.toggle('open', !isOpen);
    btn.setAttribute('aria-expanded', String(!isOpen));
  }
  document.addEventListener('click', function(e){
    const btn = e.target.closest('[data-acc-btn]');
    if(!btn) return;
    toggle(btn);
  });
})();
