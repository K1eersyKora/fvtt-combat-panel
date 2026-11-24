package org.kora.table;

import android.app.Activity;
import android.net.Uri;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import java.io.*;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONArray;
import org.json.JSONObject;

/** App-private, content-addressed storage survives both restarts and a change of tunnel hostname. */
public final class WorldAssets {
    private final Activity activity;
    private final WebView view;
    private final Uri origin;
    private final File root;
    private final ExecutorService workers=Executors.newFixedThreadPool(2);
    private final ExecutorService maintenance=Executors.newSingleThreadExecutor();
    private final java.util.concurrent.atomic.AtomicLong cacheGeneration=new java.util.concurrent.atomic.AtomicLong();
    private volatile String scope="";
    private volatile boolean closed;
    WorldAssets(Activity activity,WebView view,Uri origin){
        this.activity=activity;this.view=view;this.origin=origin;
        root=new File(activity.getNoBackupFilesDir(),"world-assets-v1");
    }
    private static boolean digest(String s){return s!=null&&s.matches("[0-9a-f]{64}");}
    @JavascriptInterface public synchronized void openScope(String value){scope=digest(value)?value:"";if(!scope.isEmpty())activity.getPreferences(0).edit().putString("lastAssetScope",scope).apply();}
    @JavascriptInterface public synchronized boolean resourceSyncEnabled(){
        return digest(scope)&&activity.getPreferences(0).getBoolean("resourceSync/"+scope,false);
    }
    @JavascriptInterface public synchronized void setResourceSync(boolean value){
        if(digest(scope))activity.getPreferences(0).edit().putBoolean("resourceSync/"+scope,value).apply();
    }
    private boolean currentActorLayout(String folder,String actorId){
        return digest(folder)&&folder.equals(scope)&&actorId!=null&&actorId.matches("[a-zA-Z0-9_-]{1,80}");
    }
    @JavascriptInterface public synchronized String getDockItems(String folder,String actorId){
        if(!currentActorLayout(folder,actorId))return "";
        return activity.getPreferences(0).getString("dockItems/"+folder+"/"+actorId,"");
    }
    @JavascriptInterface public synchronized boolean saveDockItems(String folder,String actorId,String json){
        if(!currentActorLayout(folder,actorId)||json==null||json.length()>131072)return false;
        activity.getPreferences(0).edit().putString("dockItems/"+folder+"/"+actorId,json).apply();
        return true;
    }
    @JavascriptInterface public String lastCardScope(){return activity.getPreferences(0).getString("lastCardScope","");}
    @JavascriptInterface public synchronized boolean saveCard(String json){
        String folder=scope;if(!digest(folder)||json==null||json.length()>4000000)return false;
        File dir=new File(root,folder);if(!dir.isDirectory()&&!dir.mkdirs()&&!dir.isDirectory())return false;
        android.util.AtomicFile target=new android.util.AtomicFile(new File(dir,"character.json"));FileOutputStream out=null;
        try{out=target.startWrite();out.write(json.getBytes("UTF-8"));target.finishWrite(out);
            activity.getPreferences(0).edit().putString("lastCardScope",folder).apply();return true;
        }catch(Exception e){if(out!=null)target.failWrite(out);return false;}
    }
    @JavascriptInterface public synchronized String readCard(String folder){
        if(!digest(folder)||(!folder.equals(scope)&&!(scope.isEmpty()&&folder.equals(lastCardScope()))))return "";
        try{return new String(new android.util.AtomicFile(new File(new File(root,folder),"character.json")).readFully(),"UTF-8");}
        catch(Exception e){return "";}
    }
    private File file(String folder,String key){return new File(new File(root,folder),key);}
    @JavascriptInterface public String storage(String op,String range,boolean includeCard){
        if(closed||!("inspect".equals(op)||"clear".equals(op))||!("current".equals(range)||"all".equals(range)))return "";
        String selected=scope.isEmpty()?activity.getPreferences(0).getString("lastAssetScope",lastCardScope()):scope;
        boolean clear="clear".equals(op),all="all".equals(range);String id=UUID.randomUUID().toString();
        if(clear)cacheGeneration.incrementAndGet();
        maintenance.execute(()->{
            JSONObject result=new JSONObject();long bytes=0,cardBytes=0,freed=0;int count=0,cards=0;
            try{
                File base=root.getCanonicalFile();File[] dirs=base.listFiles();
                if(dirs!=null)for(File dir:dirs){
                    if(!digest(dir.getName())||(!all&&!dir.getName().equals(selected))||!dir.isDirectory()||!dir.getCanonicalFile().equals(dir))continue;
                    File[] entries=dir.listFiles();if(entries==null)continue;
                    for(File f:entries){
                        String name=f.getName();boolean card=name.equals("character.json")||name.equals("character.json.bak")||name.equals("character.json.new");
                        boolean cacheFile=digest(name)||(name.startsWith("asset-")&&name.endsWith(".part"));
                        if((!card&&!cacheFile)||!f.isFile()||!f.getCanonicalFile().equals(f))continue;
                        long size=f.length();
                        if(clear&&(!card||includeCard)){if(f.delete())freed+=size;else if(f.exists())throw new IOException("部分文件仍在使用，请重试");}
                        else if(card){cardBytes+=size;if(name.equals("character.json"))cards++;}else{bytes+=size;count++;}
                    }
                }
                String last=lastCardScope();
                if(clear&&includeCard&&digest(last)&&!file(last,"character.json").exists()){
                    String replacement="";long newest=0;
                    if(dirs!=null)for(File d:dirs){File f=new File(d,"character.json");if(digest(d.getName())&&d.getCanonicalFile().equals(d)&&f.isFile()&&f.lastModified()>newest){newest=f.lastModified();replacement=d.getName();}}
                    activity.getPreferences(0).edit().putString("lastCardScope",replacement).apply();
                }
                result.put("files",count).put("bytes",bytes).put("cards",cards).put("cardBytes",cardBytes).put("freed",freed).put("location",base.getAbsolutePath());
            }catch(Exception e){try{result.put("error",e.getMessage());}catch(Exception ignored){}}
            storageEvent(id,result);
        });return id;
    }
    @JavascriptInterface public String prune(String manifest){
        String selected=scope;
        if(closed||!digest(selected)||manifest==null||manifest.length()>6000000)return "";
        String id=UUID.randomUUID().toString();
        long generation=cacheGeneration.get();
        maintenance.execute(()->{
            JSONObject result=new JSONObject();
            try{
                Set<String> keep=new HashSet<>();
                JSONArray keys=new JSONArray(manifest);
                for(int i=0;i<keys.length();i++){
                    String key=keys.getString(i);
                    if(!digest(key))throw new IOException("资源清单不合法");
                    keep.add(key);
                }
                int removed=0;
                synchronized(this){
                    if(closed||!selected.equals(scope)||generation!=cacheGeneration.get()||!resourceSyncEnabled())
                        throw new IOException("桌位资源同步已改变");
                    File dir=new File(root.getCanonicalFile(),selected);
                    if(!dir.getCanonicalFile().equals(dir))throw new IOException("资源目录不合法");
                    File[] entries=dir.listFiles();
                    if(entries!=null){
                        cacheGeneration.incrementAndGet();
                        for(File f:entries){
                            String key=f.getName();
                            if(!digest(key)||keep.contains(key)||!f.isFile()||!f.getCanonicalFile().equals(f))continue;
                            if(f.delete())removed++;
                            else if(f.exists())throw new IOException("旧资源仍在使用，请稍后重试");
                        }
                    }
                }
                result.put("removed",removed);
            }catch(Exception e){try{result.put("error",e.getMessage());}catch(Exception ignored){}}
            storageEvent(id,result);
        });
        return id;
    }
    private void storageEvent(String id,JSONObject result){
        try{String event=new JSONObject().put("id",id).put("result",result).toString();activity.runOnUiThread(()->{
            if(!closed)view.evaluateJavascript("window.dispatchEvent(new CustomEvent('table-storage',{detail:"+event+"}))",null);
        });}catch(Exception ignored){}
    }
    @JavascriptInterface public boolean has(String key,long bytes){
        String folder=scope;if(!digest(folder)||!digest(key)||bytes<=0)return false;
        File f=file(folder,key);return f.isFile()&&f.length()==bytes;
    }
    @JavascriptInterface public String decryptCell(String secret,String encoded){
        if(secret==null||secret.length()!=44||encoded==null||encoded.length()>16000)return "";
        try{
            byte[] key=android.util.Base64.decode(secret,android.util.Base64.DEFAULT);
            javax.crypto.Cipher cipher=javax.crypto.Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(javax.crypto.Cipher.DECRYPT_MODE,new javax.crypto.spec.SecretKeySpec(key,"AES"),new javax.crypto.spec.GCMParameterSpec(128,new byte[12]));
            return android.util.Base64.encodeToString(cipher.doFinal(android.util.Base64.decode(encoded,android.util.Base64.DEFAULT)),android.util.Base64.NO_WRAP);
        }catch(Exception e){return "";}
    }
    @JavascriptInterface public String download(String key,long bytes,String token){
        final String folder=scope;
        if(closed||!digest(folder)||!digest(key)||bytes<=0||token==null||!token.matches("[a-zA-Z0-9_-]{24,100}"))return "";
        String id=UUID.randomUUID().toString();
        long version=cacheGeneration.get();workers.execute(()->transfer(id,folder,key,bytes,token,version));
        return id;
    }
    private void event(String id,long bytes,boolean done,String error){
        try{
            String json=new JSONObject().put("id",id).put("bytes",bytes).put("done",done).put("error",error).toString();
            activity.runOnUiThread(()->{if(!closed)view.evaluateJavascript("window.dispatchEvent(new CustomEvent('table-resource',{detail:"+json+"}))",null);});
        }catch(Exception ignored){}
    }
    private void transfer(String id,String folder,String key,long expected,String token,long version){
        HttpURLConnection connection=null;File tmp=null;long count=0;
        try{
            File dest=file(folder,key),dir=dest.getParentFile();
            if(!dir.isDirectory()&&!dir.mkdirs()&&!dir.isDirectory())throw new IOException("无法创建手机缓存");
            if(dest.isFile()&&dest.length()==expected){event(id,expected,true,"");return;}
            connection=(HttpURLConnection)new URL(origin.toString()+"/api/pack/file").openConnection();
            connection.setRequestMethod("POST");connection.setDoOutput(true);connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(20000);connection.setReadTimeout(60000);
            connection.setRequestProperty("Authorization","Bearer "+token);connection.setRequestProperty("Content-Type","application/json");
            connection.setRequestProperty("Accept","application/octet-stream");connection.setRequestProperty("X-Pinggy-No-Screen","1");
            try(OutputStream out=connection.getOutputStream()){out.write(("{\"key\":\""+key+"\"}").getBytes("UTF-8"));}
            int code=connection.getResponseCode();if(code!=200)throw new IOException("HTTP "+code);
            MessageDigest sha=MessageDigest.getInstance("SHA-256");tmp=File.createTempFile("asset-",".part",dir);
            try(InputStream in=connection.getInputStream();FileOutputStream out=new FileOutputStream(tmp)){
                byte[] buffer=new byte[65536];long last=0;int n;
                while((n=in.read(buffer))!=-1){
                    if(closed||version!=cacheGeneration.get()||!folder.equals(scope))throw new IOException("下载已停止");
                    count+=n;if(count>expected)throw new IOException("文件大小不符");sha.update(buffer,0,n);out.write(buffer,0,n);
                    long now=android.os.SystemClock.elapsedRealtime();if(now-last>=200){last=now;event(id,count,false,"");}
                }
            }
            StringBuilder sum=new StringBuilder();for(byte b:sha.digest())sum.append(String.format(Locale.ROOT,"%02x",b&255));
            if(count!=expected||!key.contentEquals(sum))throw new IOException("资源校验失败");
            synchronized(this){
                if(closed||version!=cacheGeneration.get()||!folder.equals(scope))throw new IOException("下载已停止");
                if(!tmp.renameTo(dest)&&(!dest.isFile()||dest.length()!=expected))throw new IOException("无法保存资源");
            }
            event(id,count,true,"");
        }catch(Exception e){event(id,count,false,e.getMessage()==null?"资源下载失败":e.getMessage());}
        finally{if(connection!=null)connection.disconnect();if(tmp!=null&&tmp.exists())tmp.delete();}
    }
    WebResourceResponse read(Uri uri){
        String key=uri.getLastPathSegment(),type=uri.getQueryParameter("type"),folder=scope;
        if(!digest(key)||!digest(folder)||type==null||!type.matches("image/(png|apng|gif|webp|avif|jpeg|svg\\+xml)|video/(webm|mp4)|application/(x-fvtt-terrain|json)"))return null;
        try{return new WebResourceResponse(type,null,new FileInputStream(file(folder,key)));}catch(IOException e){return null;}
    }
    void close(){closed=true;scope="";workers.shutdownNow();maintenance.shutdownNow();}
}
