export function createPreferences(storage, key = 'codex-color-labels.demo.v1') {
  const colors = ['red', 'orange', 'yellow', 'green', 'blue', 'purple'];
  const palette = {
    red: { name:'红色', light:'192, 51, 62', dark:'255, 119, 130' },
    orange: { name:'橙色', light:'176, 83, 15', dark:'255, 173, 92' },
    yellow: { name:'黄色', light:'151, 111, 0', dark:'240, 203, 73' },
    green: { name:'绿色', light:'37, 131, 71', dark:'99, 211, 137' },
    blue: { name:'蓝色', light:'43, 106, 204', dark:'114, 169, 255' },
    purple: { name:'紫色', light:'191, 90, 242', dark:'204, 146, 255' },
  };
  const isColor = color => typeof color === 'string' && (colors.includes(color) || /^#[0-9a-fA-F]{6}$/.test(color));
  const rgb = color => palette[color] ? palette[color].light.split(',').map(Number) : [1,3,5].map(index=>parseInt(color.slice(index,index+2),16));
  const toHex = color => '#' + rgb(color).map(value=>value.toString(16).padStart(2,'0')).join('');
  function hsvToRGB(hue,saturation,value=1) {
    hue=((hue%360)+360)%360; saturation=Math.max(0,Math.min(1,saturation)); value=Math.max(0,Math.min(1,value));
    const chroma=value*saturation,x=chroma*(1-Math.abs((hue/60)%2-1)),m=value-chroma;
    const channels=hue<60?[chroma,x,0]:hue<120?[x,chroma,0]:hue<180?[0,chroma,x]:hue<240?[0,x,chroma]:hue<300?[x,0,chroma]:[chroma,0,x];
    return channels.map(channel=>Math.round((channel+m)*255));
  }
  function hsvToHex(hue,saturation,value=1) { return '#' + hsvToRGB(hue,saturation,value).map(value=>value.toString(16).padStart(2,'0')).join(''); }
  function toHSV(color) {
    const [r,g,b]=rgb(color).map(value=>value/255),max=Math.max(r,g,b),min=Math.min(r,g,b),delta=max-min;
    const hue=!delta?0:60*(max===r?((g-b)/delta)%6:max===g?(b-r)/delta+2:(r-g)/delta+4);
    return {hue:(hue+360)%360,saturation:max?delta/max:0,value:max};
  }
  function luminance(channels) {
    const [r,g,b]=channels.map(value=>{value/=255;return value<=.04045?value/12.92:((value+.055)/1.055)**2.4;});
    return .2126*r+.7152*g+.0722*b;
  }
  function readableRGB(channels,dark) {
    const background=luminance(dark?[45,45,45]:[255,255,255]),target=dark?255:0;
    const contrast=rgb=>{const light=luminance(rgb);return(Math.max(light,background)+.05)/(Math.min(light,background)+.05);};
    if(contrast(channels)>=4.5)return channels;
    let low=0,high=1;
    const mix=amount=>channels.map(value=>Math.round(value+(target-value)*amount));
    for(let i=0;i<16;i++){const middle=(low+high)/2;if(contrast(mix(middle))>=4.5)high=middle;else low=middle;}
    return mix(high);
  }
  function paint(color) {
    if(palette[color])return palette[color];
    const channels=rgb(color);
    return{light:readableRGB(channels,false).join(', '),dark:readableRGB(channels,true).join(', ')};
  }
  const empty = () => ({ version: 1, paused: false, projects: {} });
  function validate(value) {
    if (!value || value.version !== 1 || typeof value.paused !== 'boolean' ||
        !value.projects || typeof value.projects !== 'object' || Array.isArray(value.projects) ||
        Object.keys(value).some(k => !['version', 'paused', 'projects'].includes(k)) ||
        Object.entries(value.projects).some(([id, color]) => !/^local:[a-zA-Z0-9_-]{1,128}$/.test(id) || !isColor(color)) ||
        Object.keys(value.projects).length > 2000) throw new Error('配色记录损坏或格式不受支持；请用“清除全部配色”重置');
    return { version: 1, paused: value.paused, projects: { ...value.projects } };
  }
  return {
    key, colors, palette, isColor, toHex, toHSV, hsvToRGB, hsvToHex, paint, empty, validate,
    load() {
      const raw = storage.getItem(key);
      if (raw === null) return empty();
      if (raw.length > 300000) throw new Error('配色记录过大，请清除本工具的配色记录');
      try { return validate(JSON.parse(raw)); }
      catch { throw new Error('配色记录损坏或格式不受支持；请用“清除全部配色”重置'); }
    },
    save(value) {
      const result = validate(value), raw = JSON.stringify(result);
      storage.setItem(key, raw);
      if (storage.getItem(key) !== raw) throw new Error('保存配色失败；此次更改未应用');
      return result;
    },
    clear() {
      storage.removeItem(key);
      if (storage.getItem(key) !== null) throw new Error('清除配色失败');
      return empty();
    },
  };
}
