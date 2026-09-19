const fs = require('fs');
let c = fs.readFileSync('src/App.tsx', 'utf8');

c = c.replace(
  /className=\{`flex \$\{desktopSidebarOpen \? 'flex-row justify-start gap-4 px-4' : 'flex-col items-center justify-center gap-1 mx-auto'\} w-full \$\{desktopSidebarOpen \? 'h-12' : 'h-14'\} rounded-2xl transition-all duration-200 \$\{\s+activeTab === '(.*?)'\s+\? 'bg-slate-200 text-slate-900 dark:bg-slate-800 dark:text-white shadow-sm'\s+: 'text-(.*?) hover:bg-(.*?) dark:hover:bg-(.*?) hover:text-(.*?) dark:hover:text-(.*?)'\s+\}`\}/g,
  (match, tab, color1, color2, color3, color4, color5) => {
    return `className={\`flex \${desktopSidebarOpen ? 'flex-row justify-start gap-4 px-4' : 'flex-col items-center justify-center gap-1 mx-auto'} w-[92%] mx-auto \${desktopSidebarOpen ? 'h-12' : 'h-14'} rounded-2xl transition-all duration-300 ease-out \${\n                activeTab === '${tab}' \n                  ? 'bg-slate-200 text-slate-900 dark:bg-slate-800/80 dark:text-white dark:shadow-[inset_0_1px_1px_rgba(255,255,255,0.05),0_0_20px_rgba(255,255,255,0.02)] dark:border dark:border-slate-700/50 shadow-sm transform dark:scale-105' \n                  : 'text-${color1} hover:bg-${color2} dark:hover:bg-${color3} hover:text-${color4} dark:hover:text-${color5}'\n              }\`}`;
  }
);

// Specifically handle the Insights button since it has slightly different colors
c = c.replace(
  /className=\{`relative flex \$\{desktopSidebarOpen \? 'flex-row justify-start gap-4 px-4' : 'flex-col items-center justify-center gap-1 mx-auto'\} w-full \$\{desktopSidebarOpen \? 'h-12' : 'h-14'\} rounded-2xl transition-all duration-200 \$\{\s+activeTab === 'insights'\s+\? 'bg-slate-200 text-indigo-700 dark:bg-slate-800 dark:text-indigo-400 shadow-sm'\s+: 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800\/50 hover:text-indigo-600 dark:hover:text-indigo-400'\s+\}`\}/g,
  `className={\`relative flex \${desktopSidebarOpen ? 'flex-row justify-start gap-4 px-4' : 'flex-col items-center justify-center gap-1 mx-auto'} w-[92%] mx-auto \${desktopSidebarOpen ? 'h-12' : 'h-14'} rounded-2xl transition-all duration-300 ease-out \${\n                activeTab === 'insights' \n                  ? 'bg-slate-200 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-400 dark:shadow-[inset_0_1px_1px_rgba(99,102,241,0.2),0_0_20px_rgba(99,102,241,0.1)] dark:border dark:border-indigo-500/20 shadow-sm transform dark:scale-105' \n                  : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/50 hover:text-indigo-600 dark:hover:text-indigo-400'\n              }\`}`
);

fs.writeFileSync('src/App.tsx', c);
console.log('Done!');
