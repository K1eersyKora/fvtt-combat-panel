package org.kora.table;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.SharedPreferences;
import android.content.pm.ActivityInfo;
import android.graphics.Color;
import android.graphics.drawable.Drawable;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.LayerDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.os.Build;
import android.text.InputType;
import android.text.TextUtils;
import android.view.Gravity;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.*;
import java.io.ByteArrayInputStream;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

public final class TableActivity extends Activity {
    private WebView web;
    private WorldAssets worldAssets;
    private FrameLayout screen;
    private boolean immersive;
    private Uri origin;
    private static final String RECENT_TABLES_KEY = "recentTables";
    private static final int RECENT_TABLE_LIMIT = 5;
    private static final String[] COLOR_KEYS={"highlight","edgeStart","edgeEnd","base"};
    private static final String[] DEFAULT_COLORS={"#f0d69b","#9ce3df","#bd9ee8","#162630"};
    private int palette(int index){return Color.parseColor(getPreferences(0).getString(COLOR_KEYS[index],DEFAULT_COLORS[index]));}
    private static int blend(int a,int b,float t){return Color.rgb(Math.round(Color.red(a)*(1-t)+Color.red(b)*t),Math.round(Color.green(a)*(1-t)+Color.green(b)*t),Math.round(Color.blue(a)*(1-t)+Color.blue(b)*t));}
    private int ink(){return Color.luminance(palette(3))>.29?Color.rgb(17,22,33):Color.rgb(238,231,214);}
    private Drawable surface(boolean active){
        GradientDrawable edge=new GradientDrawable(GradientDrawable.Orientation.TL_BR,new int[]{active?palette(0):palette(1),blend(palette(3),palette(1),.24f),palette(2)});
        edge.setCornerRadius(dp(8));GradientDrawable glass=new GradientDrawable(GradientDrawable.Orientation.TL_BR,new int[]{blend(palette(3),active?palette(0):Color.WHITE,active?.22f:.09f),palette(3),blend(palette(3),palette(2),.08f)});
        glass.setCornerRadius(dp(7));LayerDrawable layers=new LayerDrawable(new Drawable[]{edge,glass});layers.setLayerInset(1,dp(1),dp(1),dp(1),dp(1));return layers;
    }
    private void bars(){
        int base=palette(3);
        screen.setBackgroundColor(base);
        getWindow().setStatusBarColor(base);
        getWindow().setNavigationBarColor(base);
        boolean light=Color.luminance(base)>.29;
        if(Build.VERSION.SDK_INT>=30){
            WindowInsetsController controller=getWindow().getInsetsController();
            if(controller!=null){
                int icons=WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS|WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
                controller.setSystemBarsAppearance(light?icons:0,icons);
                controller.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                controller.show(WindowInsets.Type.statusBars());
                if(immersive)controller.hide(WindowInsets.Type.navigationBars());
                else controller.show(WindowInsets.Type.navigationBars());
            }
        }else{
            int flags=View.SYSTEM_UI_FLAG_LAYOUT_STABLE|View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION;
            if(light)flags|=View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR|View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
            if(immersive)flags|=View.SYSTEM_UI_FLAG_HIDE_NAVIGATION|View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY;
            getWindow().getDecorView().setSystemUiVisibility(flags);
        }
        screen.requestApplyInsets();
    }
    private WindowInsets fitScreen(View root,WindowInsets insets){
        if(Build.VERSION.SDK_INT>=30){
            android.graphics.Insets safe=insets.getInsets(WindowInsets.Type.systemBars()|WindowInsets.Type.displayCutout()
                    |WindowInsets.Type.mandatorySystemGestures()|WindowInsets.Type.ime());
            root.setPadding(safe.left,safe.top,safe.right,safe.bottom);
            return WindowInsets.CONSUMED;
        }
        int left=insets.getSystemWindowInsetLeft(),top=insets.getSystemWindowInsetTop();
        int right=insets.getSystemWindowInsetRight(),bottom=insets.getSystemWindowInsetBottom();
        if(Build.VERSION.SDK_INT>=28&&insets.getDisplayCutout()!=null){
            android.view.DisplayCutout cut=insets.getDisplayCutout();
            left=Math.max(left,cut.getSafeInsetLeft());top=Math.max(top,cut.getSafeInsetTop());
            right=Math.max(right,cut.getSafeInsetRight());bottom=Math.max(bottom,cut.getSafeInsetBottom());
        }
        if(Build.VERSION.SDK_INT>=29){
            android.graphics.Insets gestures=insets.getMandatorySystemGestureInsets();
            left=Math.max(left,gestures.left);top=Math.max(top,gestures.top);
            right=Math.max(right,gestures.right);bottom=Math.max(bottom,gestures.bottom);
        }
        root.setPadding(left,top,right,bottom);
        return Build.VERSION.SDK_INT>=28?insets.consumeDisplayCutout().consumeSystemWindowInsets():insets.consumeSystemWindowInsets();
    }
    private void showScreen(View child){
        screen.removeAllViews();
        screen.addView(child,new FrameLayout.LayoutParams(-1,-1));
        screen.requestApplyInsets();
    }
    private int dp(int n){return Math.round(getResources().getDisplayMetrics().density*n);}
    @Override public void onCreate(Bundle state){super.onCreate(state);getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        if(Build.VERSION.SDK_INT>=30)getWindow().setDecorFitsSystemWindows(false);
        screen=new FrameLayout(this);screen.setOnApplyWindowInsetsListener(this::fitScreen);setContentView(screen);
        String last=getPreferences(0).getString("table","");
        bars();if(last.isEmpty())connectScreen(); else open(last);
    }
    private List<String> readRecentTables() {
        List<String> addresses = new ArrayList<>();
        try {
            JSONArray saved = new JSONArray(getPreferences(0).getString(RECENT_TABLES_KEY, "[]"));
            for (int i = 0; i < saved.length() && addresses.size() < RECENT_TABLE_LIMIT; i++) {
                Object entry = saved.opt(i);
                if (!(entry instanceof String)) continue;
                String address = ((String) entry).trim();
                if (!address.isEmpty() && !addresses.contains(address)) addresses.add(address);
            }
        } catch (JSONException | ClassCastException ignored) {}
        return addresses;
    }
    private void saveRecentTables(SharedPreferences.Editor editor, List<String> addresses) {
        editor.putString(RECENT_TABLES_KEY, new JSONArray(addresses).toString()).apply();
    }
    private void rememberTable(String address) {
        List<String> addresses = readRecentTables();
        addresses.remove(address);
        addresses.add(0, address);
        if (addresses.size() > RECENT_TABLE_LIMIT) addresses.remove(RECENT_TABLE_LIMIT);
        saveRecentTables(getPreferences(0).edit().putString("table", address), addresses);
    }
    private void pasteAddress(EditText url) {
        ClipboardManager clipboard = getSystemService(ClipboardManager.class);
        ClipData clip = clipboard == null ? null : clipboard.getPrimaryClip();
        CharSequence text = clip != null && clip.getItemCount() > 0 ? clip.getItemAt(0).getText() : null;
        String address = text == null ? "" : text.toString().trim();
        if (address.isEmpty()) {
            Toast.makeText(this, "剪贴板中没有地址文本", Toast.LENGTH_SHORT).show();
            return;
        }
        url.setText(address);
        url.setSelection(url.length());
        url.setError(null);
    }
    private void connectionSurface(TextView view, boolean active, int minWidth, int padding, int gravity) {
        view.setBackground(surface(active));
        view.setStateListAnimator(null);
        view.setElevation(0);
        view.setMinimumHeight(0);
        view.setMinimumWidth(0);
        view.setMinHeight(dp(48));
        view.setMinWidth(dp(minWidth));
        view.setIncludeFontPadding(false);
        view.setPaddingRelative(dp(padding), dp(8), dp(padding), dp(8));
        view.setGravity(gravity);
    }
    private void addRecentTables(LinearLayout box, EditText url, Button go) {
        List<String> addresses = readRecentTables();
        if (addresses.isEmpty()) return;

        LinearLayout recent = new LinearLayout(this);
        recent.setOrientation(LinearLayout.VERTICAL);
        recent.setBackground(surface(false));
        recent.setPadding(dp(19), dp(16), dp(19), dp(16));
        recent.setClipToPadding(false);
        LinearLayout.LayoutParams recentLayout = new LinearLayout.LayoutParams(-1, -2);
        recentLayout.topMargin = dp(14);
        box.addView(recent, recentLayout);

        TextView label = new TextView(this);
        label.setText("最近连接的地址");
        label.setTextColor(ink());
        recent.addView(label);
        for (String address : addresses) {
            LinearLayout row = new LinearLayout(this);
            row.setBaselineAligned(false);
            row.setGravity(Gravity.CENTER_VERTICAL);
            LinearLayout.LayoutParams rowLayout = new LinearLayout.LayoutParams(-1, -2);
            rowLayout.topMargin = dp(8);
            recent.addView(row, rowLayout);

            Button entry = new Button(this);
            entry.setText(address);
            entry.setTextSize(14);
            entry.setTextColor(ink());
            entry.setAllCaps(false);
            entry.setSingleLine(true);
            entry.setEllipsize(TextUtils.TruncateAt.MIDDLE);
            connectionSurface(entry, false, 0, 12, Gravity.START | Gravity.CENTER_VERTICAL);
            row.addView(entry, new LinearLayout.LayoutParams(0, -1, 1));
            entry.setOnClickListener(v -> {
                url.setText(address);
                go.performClick();
            });

            Button remove = new Button(this);
            remove.setText("×");
            remove.setTextSize(18);
            remove.setTextColor(ink());
            remove.setContentDescription("删除地址 " + address);
            connectionSurface(remove, false, 0, 0, Gravity.CENTER);
            LinearLayout.LayoutParams removeLayout = new LinearLayout.LayoutParams(dp(48), -1);
            removeLayout.setMarginStart(dp(8));
            row.addView(remove, removeLayout);
            remove.setOnClickListener(v -> {
                List<String> saved = readRecentTables();
                saved.remove(address);
                saveRecentTables(getPreferences(0).edit(), saved);
                recent.removeView(row);
                if (recent.getChildCount() == 1) box.removeView(recent);
            });
        }
    }
    private void connectScreen(){
        if(worldAssets!=null){worldAssets.close();worldAssets=null;}
        if(web!=null){screen.removeView(web);web.removeJavascriptInterface("TableDisplay");web.removeJavascriptInterface("TableAssets");web.destroy();web=null;}
        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
        immersive=false;
        bars();LinearLayout box=new LinearLayout(this);box.setOrientation(LinearLayout.VERTICAL);box.setPadding(dp(22),dp(24),dp(22),dp(20));
        box.setBackground(new GradientDrawable(GradientDrawable.Orientation.TL_BR,new int[]{palette(3),blend(palette(3),palette(2),.10f)}));
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setBackground(surface(false));
        card.setPadding(dp(19), dp(19), dp(19), dp(19));
        card.setClipToPadding(false);
        box.addView(card);

        LinearLayout heading = new LinearLayout(this);
        heading.setBaselineAligned(false);
        heading.setGravity(Gravity.CENTER_VERTICAL);
        card.addView(heading);
        TextView title = new TextView(this);
        title.setText("掌上跑团");
        title.setTextSize(28);
        title.setTextColor(ink());
        heading.addView(title, new LinearLayout.LayoutParams(0, -2, 1));
        Button settings = new Button(this);
        settings.setText("设置");
        settings.setTextColor(ink());
        connectionSurface(settings, false, 88, 16, Gravity.CENTER);
        LinearLayout.LayoutParams settingsLayout = new LinearLayout.LayoutParams(-2, -2);
        settingsLayout.setMarginStart(dp(8));
        heading.addView(settings, settingsLayout);
        settings.setOnClickListener(v->open("https://table-settings.invalid",true));
        TextView label=new TextView(this);label.setText("DM 电脑上的桌面服务地址");label.setTextColor(blend(ink(),palette(3),.22f));label.setPadding(0,dp(19),0,dp(8));card.addView(label);
        LinearLayout addressRow = new LinearLayout(this);
        addressRow.setBaselineAligned(false);
        addressRow.setGravity(Gravity.CENTER_VERTICAL);
        card.addView(addressRow);
        EditText url = new EditText(this);
        url.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        url.setSingleLine(true);
        url.setHint("http://192.168.1.10:31940");
        url.setTextColor(ink());
        url.setHintTextColor(blend(ink(), palette(3), .42f));
        url.setText(getPreferences(0).getString("table", ""));
        // Both controls fill the wrap-content row, so the taller scaled label sets the shared height.
        connectionSurface(url, false, 0, 12, Gravity.START | Gravity.CENTER_VERTICAL);
        addressRow.addView(url, new LinearLayout.LayoutParams(0, -1, 1));
        Button paste = new Button(this);
        paste.setText("粘贴");
        paste.setTextColor(ink());
        connectionSurface(paste, false, 64, 16, Gravity.CENTER);
        LinearLayout.LayoutParams pasteLayout = new LinearLayout.LayoutParams(-2, -1);
        pasteLayout.setMarginStart(dp(8));
        addressRow.addView(paste, pasteLayout);
        paste.setOnClickListener(v -> pasteAddress(url));
        Button go = new Button(this);
        go.setText("连接桌位");
        go.setTextColor(ink());
        connectionSurface(go, true, 0, 16, Gravity.CENTER);
        LinearLayout.LayoutParams layout = new LinearLayout.LayoutParams(-1, -2);
        layout.topMargin = dp(14);
        card.addView(go, layout);
        go.setOnClickListener(v -> {
            try { open(url.getText().toString().trim()); }
            catch (Exception e) { url.setError("局域网请填电脑 IP 和端口；外网请填写 HTTPS 地址"); }
        });
        addRecentTables(box, url, go);
        ScrollView form=new ScrollView(this);form.setFillViewport(true);form.addView(box);showScreen(form);
    }
    private boolean localHost(String h){
        return h.equals("localhost")||h.equals("127.0.0.1")||h.endsWith(".local")||h.matches("10(\\.\\d{1,3}){3}|192\\.168(\\.\\d{1,3}){2}|172\\.(1[6-9]|2\\d|3[01])(\\.\\d{1,3}){2}");
    }
    private boolean same(Uri u){return u!=null && origin.getScheme().equals(u.getScheme())&&origin.getEncodedAuthority().equals(u.getEncodedAuthority());}
    private void open(String address){open(address,false);}
    private void open(String address,boolean settingsOnly){
        Uri u=Uri.parse(address);String host=u.getHost();
        if(host==null||u.getUserInfo()!=null||!("https".equals(u.getScheme())||("http".equals(u.getScheme())&&localHost(host))))throw new IllegalArgumentException();
        origin=Uri.parse(u.getScheme()+"://"+u.getEncodedAuthority());
        if(!settingsOnly)rememberTable(origin.toString());
        web=new WebView(this);web.setBackgroundColor(palette(3));web.getSettings().setJavaScriptEnabled(true);web.getSettings().setDomStorageEnabled(true);
        web.getSettings().setAllowFileAccess(false);web.getSettings().setAllowContentAccess(false);web.getSettings().setMediaPlaybackRequiresUserGesture(false);
        worldAssets=new WorldAssets(this,web,origin);web.addJavascriptInterface(worldAssets,"TableAssets");
        web.addJavascriptInterface(new Object(){@JavascriptInterface public void mapExpanded(boolean on){runOnUiThread(()->{
            immersive=on;bars();
        });}
        @JavascriptInterface public void haptic(String kind){
            runOnUiThread(() -> {
                View target = web != null ? web : screen;
                if (target == null) return;
                int effect = android.view.HapticFeedbackConstants.KEYBOARD_TAP;
                if ("confirm".equals(kind)) {
                    effect = Build.VERSION.SDK_INT >= 30
                        ? android.view.HapticFeedbackConstants.CONFIRM
                        : android.view.HapticFeedbackConstants.VIRTUAL_KEY;
                } else if ("error".equals(kind)) {
                    effect = Build.VERSION.SDK_INT >= 30
                        ? android.view.HapticFeedbackConstants.REJECT
                        : android.view.HapticFeedbackConstants.LONG_PRESS;
                }
                try { target.performHapticFeedback(effect); } catch (Exception ignored) {}
            });
        }
        @JavascriptInterface public String getDockLayout(){
            try{return new JSONObject().put("rows",getPreferences(0).getInt("dockRows",1)).put("folded",getPreferences(0).getBoolean("dockFolded",false)).toString();}
            catch(Exception ignored){return "{}";}
        }
        @JavascriptInterface public void saveDockLayout(int rows,boolean folded){
            if(rows>=1&&rows<=3)getPreferences(0).edit().putInt("dockRows",rows).putBoolean("dockFolded",folded).apply();
        }
        @JavascriptInterface public int getDockGroups(){
            return getPreferences(0).getInt("dockGroups",15);
        }
        @JavascriptInterface public void saveDockGroups(int mask){
            if(mask>=0&&mask<=15)getPreferences(0).edit().putInt("dockGroups",mask).apply();
        }
        @JavascriptInterface public int getChatHeight(){
            return getPreferences(0).getInt("chatHeight",0);
        }
        @JavascriptInterface public void saveChatHeight(int cssPx){
            if(cssPx>=0&&cssPx<=1200)getPreferences(0).edit().putInt("chatHeight",cssPx).apply();
        }
        @JavascriptInterface public void changeServer(){runOnUiThread(()->connectScreen());}
        @JavascriptInterface public String getPalette(){try{JSONObject colors=new JSONObject();for(int i=0;i<COLOR_KEYS.length;i++)colors.put(COLOR_KEYS[i],getPreferences(0).getString(COLOR_KEYS[i],DEFAULT_COLORS[i]));
            return new JSONObject().put("mode",getPreferences(0).getString("themeMode","follow")).put("colors",colors).toString();}catch(Exception e){return "null";}}
        @JavascriptInterface public void savePalette(String mode,String highlight,String a,String b,String base){
            if(!"custom".equals(mode)&&!"follow".equals(mode))return;String[] list={highlight,a,b,base};
            for(String c:list)if(c==null||!c.matches("#[0-9a-fA-F]{6}"))return;
            SharedPreferences.Editor edit=getPreferences(0).edit().putString("themeMode",mode);for(int i=0;i<list.length;i++)edit.putString(COLOR_KEYS[i],list[i]);edit.apply();runOnUiThread(()->bars());
        }},"TableDisplay");
        web.setWebViewClient(new WebViewClient(){
            @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest req){return true;}
            @Override public WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest req){
                Uri url=req.getUrl();String p=url.getPath();
                if(!req.isForMainFrame()&&"data".equals(url.getScheme())){
                    String data=url.toString();
                    if(data.startsWith("data:image/jpeg;base64,")||data.startsWith("data:image/webp;base64,")||data.startsWith("data:image/png;base64,"))return null;
                }
                if(same(url)&&p!=null){
                    if(!settingsOnly&&Arrays.asList("/api/pair","/api/poll","/api/signal","/api/leave","/api/relay/push","/api/relay/pull","/api/pack/request","/api/pack/status","/api/pack/file").contains(p))return null;
                    if(!req.isForMainFrame()&&p.startsWith("/__pack/")&&worldAssets!=null){WebResourceResponse asset=worldAssets.read(url);if(asset!=null)return asset;}
                    String file=p.equals("/")?"index.html":p.substring(1);
                    if(Arrays.asList("index.html","app.js","chat.js","dice.js","snap.js","map-render.js","asset-cache.js","terrain.js","animation.js","theme.js","settings.js","camera.js","relay.js","style.css","check-prompt.js","prompt-ui.js","dock-items.js","sheet-ui.js","combat-hud.js").contains(file))try{
                        String mime=file.endsWith(".js")?"application/javascript":file.endsWith(".css")?"text/css":"text/html";
                        return new WebResourceResponse(mime,"UTF-8",getAssets().open(file));
                    }catch(Exception ignored){}
                }
                return new WebResourceResponse("text/plain","UTF-8",403,"Forbidden",null,new ByteArrayInputStream(new byte[0]));
            }
        });showScreen(web);web.loadUrl(origin.toString()+(settingsOnly?"/#settings":"/"));
    }
    @Override public void onBackPressed(){
        if(web==null){super.onBackPressed();return;}
        web.evaluateJavascript("(function(){"
                + "const prompt=document.getElementById('desktopPrompt');"
                + "if(prompt?.open){"
                + "for(const id of ['desktopPromptDefer','desktopPromptDismiss']){"
                + "const button=document.getElementById(id);"
                + "if(button?.getClientRects().length&&!button.disabled&&getComputedStyle(button).visibility==='visible'){button.click();return true;}}"
                + "if(typeof prompt.requestClose==='function')prompt.requestClose();"
                + "else if(prompt.dispatchEvent(new Event('cancel',{cancelable:true})))prompt.close?.();"
                + "return true;}"
                + "if(document.getElementById('bg3CheckPrompt')?.open){document.getElementById('bg3CheckDefer')?.click();return true;}"
                + "if(document.getElementById('dockItems')?.open){document.getElementById('dockItemsClose')?.click();return true;}"
                + "return false;})()",result->{
            if(!"true".equals(result))backInGame();
        });
    }
    private void backInGame(){
        if(web==null)return;
        web.evaluateJavascript("(function(){"
                + "if(document.getElementById('dockVisibility')?.open){document.getElementById('dockSettingsClose').click();return true;}"
                + "if(document.getElementById('appearance')?.open){document.getElementById('themeClose').click();return true;}"
                + "if(document.getElementById('settings')?.open){const p=document.getElementById('clearPrompt');document.getElementById(p&&!p.hidden?'cancelClear':'settingsClose').click();return true;}"
                + "const peek=document.getElementById('tokenPeek');if(peek&&!peek.hidden){peek.dispatchEvent(new CustomEvent('dismiss'));return true;}"
                + "const dice=document.getElementById('diceTray');if(dice&&!dice.hidden){document.getElementById('diceToggle')?.click();return true;}"
                + "const combat=document.getElementById('combatList');if(combat&&!combat.hidden){document.getElementById('combatPill')?.click();return true;}"
                + "const tokens=document.getElementById('tokenSwitchMenu');if(tokens&&!tokens.hidden){document.getElementById('tokenSwitchBtn')?.click();return true;}"
                + "const quickRoll=document.getElementById('sheetQuickRoll');if(quickRoll&&!quickRoll.hidden){document.getElementById('sheetQuickRollClose')?.click();return true;}"
                + "const modes=document.getElementById('itemModes');"
                + "if(modes?.getClientRects().length&&!modes.hidden&&!modes.inert){"
                + "const close=document.getElementById('itemModesClose');"
                + "if(close?.getClientRects().length&&!close.disabled)close.click();"
                + "else if(modes.open)modes.close?.();"
                + "else modes.hidden=true;"
                + "return true;}"
                + "if(document.body?.classList.contains('mapExpanded')){document.getElementById('mapExpandBtn')?.click();return true;}"
                + "for(const id of ['cancelMap','backChoice','backSheet']){const e=document.getElementById(id);if(e&&e.offsetParent!==null){e.click();return true;}}"
                + "return false;})()",value->{
            if(!"true".equals(value))new android.app.AlertDialog.Builder(this).setMessage("返回桌面服务地址设置？").setNegativeButton("留在桌位",null).setPositiveButton("返回",(d,w)->connectScreen()).show();
        });
    }
    @Override protected void onDestroy(){if(worldAssets!=null)worldAssets.close();super.onDestroy();}
}
