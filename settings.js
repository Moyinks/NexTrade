const Settings = (() => {
  'use strict';
  let container = null;
  let sheet = null;
  let returnRoute = 'home';
  const OPTIONS = Object.freeze([
    { id:'dark', title:'Dark', copy:'Institutional Obsidian' },
    { id:'light', title:'Light', copy:'Calm paper workspace' },
    { id:'system', title:'System', copy:'Follow this device' }
  ]);
  function node(tag,className,text){const el=document.createElement(tag);if(className)el.className=className;if(text!==undefined)el.textContent=text;return el;}
  function preference(){return window.ThemeManager?ThemeManager.getPreference():'dark';}
  function themeLabel(){const x=OPTIONS.find(o=>o.id===preference());return x?x.title:'Dark';}
  function versionLabel(){return (window.APP_CONFIG&&APP_CONFIG.version)||'2.1.0';}
  function back(){closeThemeSheet();if(window.App&&typeof App.back==='function'){App.back(returnRoute||'home');return;}if(window.App&&App.navigate)App.navigate(returnRoute||'home');}
  function open(){const current=window.Router&&Router.getCurrentPage?Router.getCurrentPage():null;if(current&&current!=='settings')returnRoute=current;if(window.App&&App.navigate)App.navigate('settings');}
  function closeThemeSheet(){if(!sheet)return;sheet.classList.remove('is-open');sheet.setAttribute('aria-hidden','true');const closing=sheet;sheet=null;window.setTimeout(()=>closing.remove(),220);}
  function refreshThemeValue(){if(!container)return;const value=container.querySelector('[data-settings-theme-value]');if(value)value.textContent=themeLabel();}
  function themeOption(option){
    const button=node('button','settings-theme-option');button.type='button';button.dataset.themeChoice=option.id;button.setAttribute('aria-pressed',String(preference()===option.id));
    const preview=node('span','settings-theme-preview');preview.dataset.preview=option.id;
    const body=node('span','settings-theme-option__body');body.append(node('span','settings-theme-option__title',option.title),node('span','settings-theme-option__copy',option.copy));
    const check=node('span','settings-theme-option__check');const icon=node('i');icon.className='fas fa-check';check.appendChild(icon);
    button.append(preview,body,check);button.addEventListener('click',()=>{if(!window.ThemeManager)return;ThemeManager.setPreference(option.id);refreshThemeValue();closeThemeSheet();});return button;
  }
  function openThemeSheet(){
    if(sheet||!container)return;sheet=node('div','settings-sheet-layer');sheet.setAttribute('aria-hidden','false');
    const scrim=node('button','settings-sheet-scrim');scrim.type='button';scrim.setAttribute('aria-label','Close theme chooser');scrim.addEventListener('click',closeThemeSheet);
    const panel=node('section','settings-sheet');panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-label','Choose theme');panel.appendChild(node('div','settings-sheet__handle'));
    const heading=node('div','settings-sheet__heading');heading.append(node('div','settings-sheet__title','Theme'),node('div','settings-sheet__copy','Choose how your workspace is presented. Financial meaning never changes.'));panel.appendChild(heading);
    const list=node('div','settings-theme-list');OPTIONS.forEach(o=>list.appendChild(themeOption(o)));panel.appendChild(list);sheet.append(scrim,panel);document.body.appendChild(sheet);requestAnimationFrame(()=>{if(sheet)sheet.classList.add('is-open');});
  }
  function settingsRow({icon,title,subtitle,value,action,chevron=true}){
    const row=node(action?'button':'div','settings-row');if(action){row.type='button';row.addEventListener('click',action);}const iconBox=node('span','settings-row__icon');const glyph=node('i');glyph.className='fas '+icon;iconBox.appendChild(glyph);
    const body=node('span','settings-row__body');body.appendChild(node('span','settings-row__title',title));if(subtitle)body.appendChild(node('span','settings-row__subtitle',subtitle));
    const trailing=node('span','settings-row__trailing');if(value){const v=node('span','settings-row__value',value);if(title==='Theme')v.dataset.settingsThemeValue='true';trailing.appendChild(v);}if(chevron&&action){const arrow=node('i');arrow.className='fas fa-chevron-right';trailing.appendChild(arrow);}row.append(iconBox,body,trailing);return row;
  }
  function group(title){const wrap=node('section','settings-group');wrap.appendChild(node('div','settings-group__label',title));const rows=node('div','settings-group__rows');wrap.appendChild(rows);return{wrap,rows};}
  function render(target){
    container=target;if(!container)return;container.replaceChildren();const page=node('section','settings-page');
    const backButton=node('button','settings-back');backButton.type='button';const backIcon=node('i');backIcon.className='fas fa-arrow-left';backButton.append(backIcon,node('span','','Back'));backButton.addEventListener('click',back);page.appendChild(backButton);
    const appearance=group('Appearance');appearance.rows.appendChild(settingsRow({icon:'fa-circle-half-stroke',title:'Theme',subtitle:'Workspace appearance',value:themeLabel(),action:openThemeSheet}));page.appendChild(appearance.wrap);
    const about=group('About');about.rows.appendChild(settingsRow({icon:'fa-layer-group',title:'NexTrade',subtitle:'Portfolio prototype',value:versionLabel(),chevron:false}));page.appendChild(about.wrap);container.appendChild(page);
  }
  function cleanup(){closeThemeSheet();container=null;}
  return Object.freeze({open,back,render,cleanup});
})();
if(typeof window!=='undefined')window.Settings=Settings;
