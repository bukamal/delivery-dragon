// Bottom Navigation Component
(function() {
  const currentPage = window.location.pathname.split('/').pop();
  
  const navItems = [
    { icon: 'home', label: 'الرئيسية', href: 'customer-home.html' },
    { icon: 'clipboard-list', label: 'طلباتي', href: 'my-orders.html' },
    { icon: 'message-circle', label: 'الدعم', href: 'support.html' },
    { icon: 'user', label: 'حسابي', href: 'profile.html' }
  ];

  const nav = document.createElement('div');
  nav.className = 'bottom-nav';
  
  navItems.forEach(item => {
    const isActive = currentPage === item.href;
    const link = document.createElement('a');
    link.href = item.href;
    link.className = `bottom-nav-item ${isActive ? 'active' : ''}`;
    link.innerHTML = `<i data-lucide="${item.icon}"></i><span>${item.label}</span>`;
    nav.appendChild(link);
  });
  
  document.body.appendChild(nav);
  if (typeof lucide !== 'undefined') lucide.createIcons();
})();
