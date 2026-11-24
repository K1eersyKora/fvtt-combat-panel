const binary=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
export class TerrainAtlas{
  constructor(blob){this.blob=blob;this.opened=new Set();this.canvas=document.createElement('canvas');}
  async init(){
    const h=new DataView(await this.blob.slice(0,20).arrayBuffer());
    if(h.getUint32(0)!==0x464d4131)throw Error('加密地图文件无效');
    this.w=h.getUint32(4,true);this.h=h.getUint32(8,true);this.step=h.getUint32(12,true);this.count=h.getUint32(16,true);
    this.cols=Math.ceil(this.w/this.step);
    if(!this.w||!this.h||this.w>2048||this.h>2048||this.step!==16||this.count!==this.cols*Math.ceil(this.h/this.step))throw Error('加密地图尺寸无效');
    this.offsets=new DataView(await this.blob.slice(20,20+4*(this.count+1)).arrayBuffer());
    this.canvas.width=this.w;this.canvas.height=this.h;this.ctx=this.canvas.getContext('2d');this.ctx.fillStyle='#000';this.ctx.fillRect(0,0,this.w,this.h);return this;
  }
  async unlock(grants){
    let cursor=0;await Promise.all(Array.from({length:8},async()=>{
      while(cursor<grants.length){
        const [i,secret]=grants[cursor++];if(!Number.isInteger(i)||i<0||i>=this.count||this.opened.has(i))continue;
        const begin=this.offsets.getUint32(i*4,true),end=this.offsets.getUint32((i+1)*4,true);
        if(end<=begin||end>this.blob.size||end-begin>12000)throw Error('地形块格式错误');
        const bytes=new Uint8Array(await this.blob.slice(begin,end).arrayBuffer());let png;
        if(crypto.subtle){
          const key=await crypto.subtle.importKey('raw',binary(secret),'AES-GCM',false,['decrypt']);
          png=await crypto.subtle.decrypt({name:'AES-GCM',iv:new Uint8Array(12)},key,bytes);
        }else if(window.TableAssets?.decryptCell){
          const decoded=window.TableAssets.decryptCell(secret,btoa(String.fromCharCode(...bytes)));if(!decoded)throw Error('地形块校验失败');png=binary(decoded);
        }else throw Error('请用 Android App 或 HTTPS 打开受保护地图');
        const img=await createImageBitmap(new Blob([png],{type:'image/png'}));this.ctx.drawImage(img,(i%this.cols)*this.step,Math.floor(i/this.cols)*this.step);img.close();this.opened.add(i);
      }
    }));
  }
}
