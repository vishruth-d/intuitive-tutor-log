// Theme + group-colour customisation. Tappable swatches only (no native colour/select UI).
export const THEMES = {classic:'Cream', sage:'Sage', ocean:'Ocean', blush:'Blush', plum:'Plum'};

export function applyTheme(theme){
  document.documentElement.dataset.theme = Object.hasOwn(THEMES,theme) ? theme : 'classic';
}

// Curated pastels for group cards. Kept in sync with the app's own palette feel.
export const GROUP_COLOURS = ['#cfe6ff','#bfe3cf','#ffe2ad','#f6c9c3','#e2d2f2','#bfeae2','#ffd1e1','#dbe8b9','#ffd2ba','#cdd8f2'];

// Theme picker: a row of tappable chips, each a mini preview of that theme.
export function themeField(theme){
  const cur = Object.hasOwn(THEMES,theme) ? theme : 'classic';
  return '<span class="fld-label">Theme</span><div class="theme-grid">' +
    Object.entries(THEMES).map(([id,name]) =>
      '<button type="button" class="theme-chip t-'+id+(id===cur?' on':'')+'" data-theme-pick="'+id+'">'+
        '<span class="theme-dot"></span><span class="theme-name">'+name+'</span>'+
      '</button>'
    ).join('') + '</div>';
}

// Group colour picker: tappable pastel swatches.
export function groupColourField(current){
  const cur = String(current||'').toLowerCase();
  return GROUP_COLOURS.map(c =>
    '<button type="button" class="swatch'+(c.toLowerCase()===cur?' on':'')+'" data-colour="'+c+'" style="--sw:'+c+'" aria-label="Group colour '+c+'"></button>'
  ).join('');
}
