package com.remindit.app;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.text.TextUtils;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.List;
import java.util.Locale;

public class MainActivity extends Activity {
    private static final int BLUE = Color.rgb(10,132,255), BLUE_DARK = Color.rgb(6,105,216), YELLOW = Color.rgb(255,200,61);
    private static final int TEXT = Color.rgb(15,23,42), MUTED = Color.rgb(100,116,139), BG = Color.rgb(247,250,255);
    private static final int CARD = Color.WHITE, BORDER = Color.rgb(226,232,240), GREEN = Color.rgb(22,163,74), RED = Color.rgb(220,38,38);
    private static final int AMBER_BG = Color.rgb(255,251,235);
    private LinearLayout reminderList;
    private View exactCard;

    @Override protected void onCreate(Bundle b) {
        super.onCreate(b);
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        getWindow().setStatusBarColor(BG); getWindow().setNavigationBarColor(Color.WHITE);
        setContentView(buildUi()); requestNotificationPermission();
    }

    @Override protected void onResume() {
        super.onResume();
        if (ReminderScheduler.canScheduleExactly(this)) new ReminderDb(this).rescheduleFuture(this);
        updateExactCard(); renderReminders();
    }

    private View buildUi() {
        ScrollView s = new ScrollView(this); s.setFillViewport(true); s.setBackgroundColor(BG);
        LinearLayout root = new LinearLayout(this); root.setOrientation(LinearLayout.VERTICAL);
        final int h=dp(18), top=dp(18), bottom=dp(36); root.setPadding(h,top,h,bottom); s.addView(root);
        ViewCompat.setOnApplyWindowInsetsListener(root,(v,w)->{ Insets bars=w.getInsets(WindowInsetsCompat.Type.systemBars()); v.setPadding(h,top+bars.top,h,bottom+bars.bottom); return w; });

        LinearLayout header=new LinearLayout(this); header.setOrientation(LinearLayout.HORIZONTAL); header.setGravity(Gravity.CENTER_VERTICAL);
        ImageView logo=new ImageView(this); logo.setImageResource(R.drawable.ic_logo); header.addView(logo,new LinearLayout.LayoutParams(dp(58),dp(58)));
        LinearLayout titles=new LinearLayout(this); titles.setOrientation(LinearLayout.VERTICAL); titles.addView(text("RemindIt",30,true,TEXT));
        titles.addView(text(LanguageManager.pick(this,"Побач зараз. Згадай вчасно.","See it now. Remember it later."),14,false,MUTED));
        LinearLayout.LayoutParams tp=new LinearLayout.LayoutParams(0,-2,1f); tp.setMargins(dp(10),0,dp(8),0); header.addView(titles,tp);
        Button language=secondaryButton("🌐 "+(LanguageManager.isUk(this)?"UA":"EN")); language.setOnClickListener(v->showLanguagePicker()); header.addView(language,new LinearLayout.LayoutParams(dp(96),dp(48)));
        root.addView(header,margin(-1,-2,0,0,0,20));

        LinearLayout hero=card(); hero.addView(text(LanguageManager.pick(this,"Поділись будь-чим. RemindIt залишить тільки суть.","Share anything. RemindIt keeps only the meaning."),20,true,TEXT));
        hero.addView(text(LanguageManager.pick(this,"Скріншот, фото, посилання або текст → одна коротка суть → точне нагадування.","Screenshot, photo, link or text → one short meaning → exact reminder."),14,false,MUTED),margin(-1,-2,0,8,0,14));
        Button add=primaryButton(LanguageManager.pick(this,"＋  Додати нагадування","＋  Add reminder")); add.setOnClickListener(v->startActivity(new Intent(this,AddReminderActivity.class))); hero.addView(add); root.addView(hero,margin(-1,-2,0,0,0,14));

        exactCard=buildExactPermissionCard(); root.addView(exactCard,margin(-1,-2,0,0,0,12));
        if (isXiaomiFamily()) root.addView(buildHyperOsCard(),margin(-1,-2,0,0,0,18));

        LinearLayout heading=new LinearLayout(this); heading.setOrientation(LinearLayout.HORIZONTAL); heading.setGravity(Gravity.CENTER_VERTICAL);
        heading.addView(text(LanguageManager.pick(this,"Майбутні","Upcoming"),23,true,TEXT),new LinearLayout.LayoutParams(0,-2,1f));
        heading.addView(text(LanguageManager.pick(this,"Приватно • Локально","Private • Local"),12,true,BLUE)); root.addView(heading,margin(-1,-2,0,0,0,10));
        reminderList=new LinearLayout(this); reminderList.setOrientation(LinearLayout.VERTICAL); root.addView(reminderList); return s;
    }

    private View buildExactPermissionCard(){ LinearLayout c=card(); c.setBackground(rounded(AMBER_BG,YELLOW,1,18)); c.addView(text(LanguageManager.pick(this,"Точний час нагадувань","Exact reminder timing"),17,true,TEXT)); c.addView(text(LanguageManager.pick(this,"RemindIt використовує системний AlarmClock, щоб нагадування приходило навіть на заблокованому екрані.","RemindIt uses Android AlarmClock so reminders can arrive even on the lock screen."),13,false,MUTED),margin(-1,-2,0,5,0,10)); Button b=secondaryButton(LanguageManager.pick(this,"Дозволити точні нагадування","Allow exact reminders")); b.setOnClickListener(v->openExactAlarmSettings()); c.addView(b); return c; }
    private View buildHyperOsCard(){ LinearLayout c=card(); c.setBackground(rounded(Color.rgb(239,246,255),BLUE,1,18)); c.addView(text(LanguageManager.pick(this,"HyperOS: фонові дозволи","HyperOS: background permissions"),16,true,TEXT)); c.addView(text(LanguageManager.pick(this,"Якщо нагадування вже працюють на заблокованому екрані — нічого змінювати не потрібно.","If reminders already work on the lock screen, nothing else is required."),13,false,MUTED),margin(-1,-2,0,6,0,10)); Button b=secondaryButton(LanguageManager.pick(this,"Налаштування RemindIt","RemindIt settings")); b.setOnClickListener(v->openAppSettings()); c.addView(b); return c; }
    private void updateExactCard(){ if(exactCard!=null) exactCard.setVisibility(ReminderScheduler.canScheduleExactly(this)?View.GONE:View.VISIBLE); }

    private void renderReminders(){
        if(reminderList==null)return; reminderList.removeAllViews(); List<Reminder> all=new ReminderDb(this).getUpcoming();
        if(all.isEmpty()){ LinearLayout e=card(); TextView em=text("🔔",34,false,TEXT); em.setGravity(Gravity.CENTER); e.addView(em); TextView t=text(LanguageManager.pick(this,"Поки нічого не потрібно пам’ятати","Nothing to remember yet"),18,true,TEXT); t.setGravity(Gravity.CENTER); e.addView(t,margin(-1,-2,0,6,0,0)); reminderList.addView(e); return; }
        SimpleDateFormat f=new SimpleDateFormat("EEE, dd MMM • HH:mm",LanguageManager.displayLocale(this)); long now=System.currentTimeMillis();
        for(Reminder r:all){ LinearLayout item=card(); LinearLayout top=new LinearLayout(this); top.setOrientation(LinearLayout.HORIZONTAL); top.setGravity(Gravity.TOP);
            top.addView(text(categoryEmoji(r.category),25,false,TEXT),new LinearLayout.LayoutParams(dp(42),-2));
            LinearLayout c=new LinearLayout(this); c.setOrientation(LinearLayout.VERTICAL); String essence=!TextUtils.isEmpty(r.goal)?r.goal:r.title; c.addView(text(essence,18,true,TEXT));
            int tc=r.remindAt<now?RED:BLUE; String ts=f.format(new Date(r.remindAt)); if(r.remindAt<now) ts=LanguageManager.pick(this,"Прострочено • ","Overdue • ")+ts; c.addView(text(ts,13,true,tc),margin(-1,-2,0,4,0,0)); top.addView(c,new LinearLayout.LayoutParams(0,-2,1f)); item.addView(top);
            if(!TextUtils.isEmpty(r.body)){ Button details=secondaryButton(LanguageManager.pick(this,"Показати деталі","Show details")); TextView raw=text(shortBody(r.body),13,false,MUTED); raw.setVisibility(View.GONE); details.setOnClickListener(v->{ boolean show=raw.getVisibility()!=View.VISIBLE; raw.setVisibility(show?View.VISIBLE:View.GONE); details.setText(LanguageManager.pick(this,show?"Сховати деталі":"Показати деталі",show?"Hide details":"Show details")); }); item.addView(details,margin(-1,dp(44),dp(42),10,0,0)); item.addView(raw,margin(-1,-2,dp(42),8,0,12)); }
            else item.addView(new View(this),new LinearLayout.LayoutParams(1,dp(10)));
            LinearLayout actions=new LinearLayout(this); actions.setOrientation(LinearLayout.HORIZONTAL); Button done=smallButton(LanguageManager.pick(this,"✓ Виконано","✓ Done"),GREEN); done.setOnClickListener(v->{ReminderScheduler.cancel(this,r.id);new ReminderDb(this).markDone(r.id);renderReminders();}); Button del=smallButton(LanguageManager.pick(this,"Видалити","Delete"),RED); del.setOnClickListener(v->{ReminderScheduler.cancel(this,r.id);new ReminderDb(this).delete(r.id);renderReminders();}); actions.addView(done,new LinearLayout.LayoutParams(0,dp(44),1f)); actions.addView(new View(this),new LinearLayout.LayoutParams(dp(8),1)); actions.addView(del,new LinearLayout.LayoutParams(0,dp(44),1f)); item.addView(actions); reminderList.addView(item,margin(-1,-2,0,0,0,10));
        }
    }

    private void showLanguagePicker(){ String[] labels={"Українська","English"}; int checked=LanguageManager.isUk(this)?0:1; new AlertDialog.Builder(this).setTitle(LanguageManager.pick(this,"Мова","Language")).setSingleChoiceItems(labels,checked,(d,w)->{LanguageManager.set(this,w==0?LanguageManager.UK:LanguageManager.EN);d.dismiss();recreate();}).show(); }
    private String shortBody(String body){ String c=body.replace('\n',' ').replaceAll("\\s+"," ").trim(); return c.length()>500?c.substring(0,497)+"…":c; }
    private String categoryEmoji(String c){ if("Travel".equals(c))return"✈️"; if("Shopping".equals(c))return"🛍️"; if("Bills".equals(c))return"💳"; if("Work".equals(c))return"💼"; if("Other".equals(c))return"🧠"; return"🔔"; }
    private boolean isXiaomiFamily(){ String m=Build.MANUFACTURER==null?"":Build.MANUFACTURER.toLowerCase(Locale.ROOT), b=Build.BRAND==null?"":Build.BRAND.toLowerCase(Locale.ROOT); return m.contains("xiaomi")||b.contains("xiaomi")||b.contains("redmi")||b.contains("poco"); }
    private void openExactAlarmSettings(){ if(Build.VERSION.SDK_INT<Build.VERSION_CODES.S)return; try{startActivity(new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:"+getPackageName())));}catch(Exception e){openAppSettings();} }
    private void openAppSettings(){ startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,Uri.parse("package:"+getPackageName()))); }
    private void requestNotificationPermission(){ if(Build.VERSION.SDK_INT>=33&&checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED) requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS},100); }
    private LinearLayout card(){LinearLayout l=new LinearLayout(this);l.setOrientation(LinearLayout.VERTICAL);l.setPadding(dp(16),dp(16),dp(16),dp(16));l.setBackground(rounded(CARD,BORDER,1,18));return l;}
    private Button primaryButton(String s){Button b=baseButton(s);b.setTextColor(Color.WHITE);b.setBackground(rounded(BLUE,BLUE_DARK,1,16));return b;}
    private Button secondaryButton(String s){Button b=baseButton(s);b.setTextColor(BLUE);b.setBackground(rounded(Color.WHITE,BLUE,1,14));return b;}
    private Button smallButton(String s,int color){Button b=baseButton(s);b.setTextColor(color);b.setTextSize(13);b.setBackground(rounded(Color.WHITE,color,1,13));return b;}
    private Button baseButton(String s){Button b=new Button(this);b.setText(s);b.setAllCaps(false);b.setTextSize(15);b.setTypeface(Typeface.DEFAULT_BOLD);b.setMinHeight(dp(48));return b;}
    private TextView text(String s,int sp,boolean bold,int color){TextView t=new TextView(this);t.setText(s);t.setTextSize(sp);t.setTextColor(color);if(bold)t.setTypeface(Typeface.DEFAULT_BOLD);return t;}
    private GradientDrawable rounded(int fill,int stroke,int sw,int radius){GradientDrawable d=new GradientDrawable();d.setColor(fill);d.setCornerRadius(dp(radius));d.setStroke(dp(sw),stroke);return d;}
    private LinearLayout.LayoutParams margin(int w,int h,int l,int t,int r,int b){LinearLayout.LayoutParams p=new LinearLayout.LayoutParams(w,h);p.setMargins(dp(l),dp(t),dp(r),dp(b));return p;}
    private int dp(int v){return Math.round(v*getResources().getDisplayMetrics().density);}
}
