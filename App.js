// App.js
import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  ScrollView,
  Alert,
  StyleSheet,
  Platform,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import * as TaskManager from "expo-task-manager";
import * as BackgroundFetch from "expo-background-fetch";

/* =============== Constants & Utils =============== */
const TASK_NAME = "MONIMONEY_SCHEDULE_CHECK";
const pad = (n) => String(n).padStart(2, "0");
const fmtDateTime = (iso) => {
  try {
    const d = new Date(iso);
    const days = ["Minggu","Senin","Selasa","Rabu","Kamis","Jumat","Sabtu"];
    const day = days[d.getDay()];
    return `${day}, ${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(
      d.getHours()
    )}:${pad(d.getMinutes())}`;
  } catch {
    return iso;
  }
};
const currency = (num) =>
  "Rp " +
  (Math.round(Number(num)) || 0)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".");
const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
const DEFAULT_CATEGORIES = [
  "Makan",
  "Transport",
  "Belanja",
  "Hiburan",
  "Tagihan",
  "Gaji",
  "Tabungan",
  "Lainnya",
];

/* =============== Notification setup (graceful on Snack) =============== */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

async function ensureNotifPermission() {
  try {
    const settings = await Notifications.getPermissionsAsync();
    if (!settings.granted) {
      await Notifications.requestPermissionsAsync();
    }
  } catch {
    // Snack web/unsupported: ignore
  }
}

async function scheduleLocalNotification({ title, body, date }) {
  try {
    await Notifications.scheduleNotificationAsync({
      content: { title, body },
      trigger: { date },
    });
  } catch {
    // Snack web/unsupported: ignore
  }
}

/* =============== Background Task =============== */
// NOTE: Works on built APK (EAS). In Snack, background task won't run.
TaskManager.defineTask(TASK_NAME, async () => {
  try {
    const loggedInUser = await AsyncStorage.getItem("loggedInUser");
    if (!loggedInUser) return BackgroundFetch.BackgroundFetchResult.NoData;

    const usersData = await AsyncStorage.getItem("users");
    const users = usersData ? JSON.parse(usersData) : {};
    const me = users[loggedInUser];
    if (!me) return BackgroundFetch.BackgroundFetchResult.NoData;

    const now = new Date();
    let changed = false;

    const schedules = me.schedules || [];
    for (let s of schedules) {
      if (s.completed) continue;
      const nextRun = s.nextRunISO ? new Date(s.nextRunISO) : null;
      if (!nextRun) continue;

      if (now >= nextRun) {
        // Apply transaction
        const w = me.wallets[s.wallet];
        if (w) {
          const t = {
            id: uid(),
            type: s.type, // 'in' | 'out'
            amount: Number(s.amount) || 0,
            category: s.category || "Terjadwal",
            note: s.note || "(Terjadwal)",
            wallet: s.wallet,
            createdAtISO: new Date().toISOString(),
          };
          w.transactions = [t, ...(w.transactions || [])];
          w.balance = t.type === "in" ? (w.balance || 0) + t.amount : (w.balance || 0) - t.amount;
          changed = true;

          // Notify
          try {
            await Notifications.scheduleNotificationAsync({
              content: {
                title:
                  t.type === "in"
                    ? "✅ Pemasukan Terjadwal"
                    : "💸 Pengeluaran Terjadwal",
                body: `${t.category}${t.note ? ` • ${t.note}` : ""} — ${currency(t.amount)} (${s.wallet})`,
              },
              trigger: null,
            });
          } catch {
            // ignore on Snack
          }
        }

        // Compute next run
        if (s.repeat === "none") {
          s.completed = true;
        } else {
          const d = nextRun;
          if (s.repeat === "daily") d.setDate(d.getDate() + 1);
          if (s.repeat === "weekly") d.setDate(d.getDate() + 7);
          if (s.repeat === "monthly") d.setMonth(d.getMonth() + 1);
          s.nextRunISO = d.toISOString();
        }
      }
    }

    if (changed) {
      me.schedules = schedules;
      users[loggedInUser] = me;
      await AsyncStorage.setItem("users", JSON.stringify(users));
      return BackgroundFetch.BackgroundFetchResult.NewData;
    }
    return BackgroundFetch.BackgroundFetchResult.NoData;
  } catch (e) {
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

async function ensureBackgroundTaskRegistered() {
  try {
    const isRegistered = await TaskManager.isTaskRegisteredAsync(TASK_NAME);
    if (!isRegistered) {
      await BackgroundFetch.registerTaskAsync(TASK_NAME, {
        minimumInterval: 15 * 60, // 15 minutes (OS may batch)
        stopOnTerminate: false,
        startOnBoot: true,
      });
    }
    await BackgroundFetch.setMinimumIntervalAsync(15 * 60);
  } catch {
    // Snack web/unsupported: ignore
  }
}

/* =============== Auth =============== */
function AuthScreen({ onAuthed }) {
  const [mode, setMode] = useState("login"); // login | signup
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const handleLogin = useCallback(async () => {
    const usersData = await AsyncStorage.getItem("users");
    const users = usersData ? JSON.parse(usersData) : {};
    if (users[username]?.password === password) {
      await AsyncStorage.setItem("loggedInUser", username);
      onAuthed(username);
    } else {
      Alert.alert("Login gagal", "Username atau password salah.");
    }
  }, [username, password, onAuthed]);

  const handleSignup = useCallback(async () => {
    if (!username || !password) {
      Alert.alert("Gagal", "Username & password wajib diisi.");
      return;
    }
    const usersData = await AsyncStorage.getItem("users");
    const users = usersData ? JSON.parse(usersData) : {};
    if (users[username]) {
      Alert.alert("Gagal", "Username sudah dipakai.");
      return;
    }
    users[username] = {
      password,
      theme: "light",
      categories: DEFAULT_CATEGORIES,
      selectedWallet: "Dompet Utama",
      wallets: {
        "Dompet Utama": { balance: 0, transactions: [] },
      },
      schedules: [],
    };
    await AsyncStorage.setItem("users", JSON.stringify(users));
    await AsyncStorage.setItem("loggedInUser", username);
    onAuthed(username);
  }, [username, password, onAuthed]);

  return (
    <View style={stylesAuth.wrap}>
      <Text style={stylesAuth.brand}>Monimoney Pro</Text>
      <View style={stylesAuth.segmentRow}>
        <TouchableOpacity
          onPress={() => setMode("login")}
          style={mode === "login" ? stylesAuth.segmentActive : stylesAuth.segment}
        >
          <Text style={mode === "login" ? stylesAuth.segmentTextActive : stylesAuth.segmentText}>
            Login
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setMode("signup")}
          style={mode === "signup" ? stylesAuth.segmentActive : stylesAuth.segment}
        >
          <Text style={mode === "signup" ? stylesAuth.segmentTextActive : stylesAuth.segmentText}>
            Daftar
          </Text>
        </TouchableOpacity>
      </View>
      <TextInput
        placeholder="Username"
        autoCapitalize="none"
        value={username}
        onChangeText={setUsername}
        style={stylesAuth.input}
      />
      <TextInput
        placeholder="Password"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
        style={stylesAuth.input}
      />
      {mode === "login" ? (
        <TouchableOpacity style={stylesAuth.btnPrimary} onPress={handleLogin}>
          <Text style={stylesAuth.btnText}>Masuk</Text>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity style={stylesAuth.btnSuccess} onPress={handleSignup}>
          <Text style={stylesAuth.btnText}>Buat Akun</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

/* =============== Theme Hook =============== */
const palette = {
  light: {
    bg: "#F6F8FC",
    card: "#FFFFFF",
    border: "#E5E7EB",
    text: "#111827",
    muted: "#6B7280",
    primary: "#635BFF",
    success: "#22C55E",
    danger: "#EF4444",
    chipBg: "#F3F4F6",
    chipBgActive: "#635BFF",
    balanceGradA: "#6EE7F9",
    balanceGradB: "#818CF8",
  },
  dark: {
    bg: "#0B1020",
    card: "#141A2B",
    border: "#222A43",
    text: "#E5E7EB",
    muted: "#9CA3AF",
    primary: "#7C83FF",
    success: "#34D399",
    danger: "#F87171",
    chipBg: "#1C2338",
    chipBgActive: "#7C83FF",
    balanceGradA: "#1F98F8",
    balanceGradB: "#6C56F9",
  },
};

/* =============== Home (Dashboard + Input) =============== */
function HomeScreen({ username, goHistory, goProfile, goScheduler }) {
  const [user, setUser] = useState(null);

  // input transaksi
  const [type, setType] = useState("out"); // 'in' | 'out'
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("Makan");
  const [note, setNote] = useState("");

  // kategori & dompet
  const [newCat, setNewCat] = useState("");
  const [newWallet, setNewWallet] = useState("");

  const loadUser = useCallback(async () => {
    const usersData = await AsyncStorage.getItem("users");
    const users = usersData ? JSON.parse(usersData) : {};
    const u = users[username];
    if (!u) return;
    setUser(u);
    if (u?.categories?.length && !u.categories.includes(category)) {
      setCategory(u.categories[0]);
    }
  }, [username, category]);

  useEffect(() => {
    loadUser();
  }, [loadUser]);

  const saveUser = useCallback(
    async (next) => {
      const usersData = await AsyncStorage.getItem("users");
      const users = usersData ? JSON.parse(usersData) : {};
      users[username] = next;
      await AsyncStorage.setItem("users", JSON.stringify(users));
      setUser(next);
    },
    [username]
  );

  const themeName = user?.theme || "light";
  const T = palette[themeName];

  const activeWalletName = user?.selectedWallet || "Dompet Utama";

  const activeWallet = useMemo(() => {
    const fallback = { balance: 0, transactions: [] };
    if (!user?.wallets) return fallback;
    return user.wallets[activeWalletName] || fallback;
  }, [user, activeWalletName]);

  const addTransaction = useCallback(async () => {
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt <= 0) {
      Alert.alert("Invalid", "Jumlah harus angka > 0.");
      return;
    }
    const t = {
      id: uid(),
      type,
      amount: amt,
      category,
      note,
      wallet: activeWalletName,
      createdAtISO: new Date().toISOString(),
    };
    const nextWallet = {
      ...activeWallet,
      balance: type === "in" ? activeWallet.balance + amt : activeWallet.balance - amt,
      transactions: [t, ...activeWallet.transactions],
    };
    const nextUser = {
      ...user,
      wallets: { ...user.wallets, [activeWalletName]: nextWallet },
    };
    await saveUser(nextUser);
    setAmount("");
    setNote("");
  }, [amount, type, category, note, activeWallet, activeWalletName, user, saveUser]);

  const addCategory = useCallback(async () => {
    const v = (newCat || "").trim();
    if (!v) return;
    if ((user?.categories || []).some((c) => c.toLowerCase() === v.toLowerCase())) {
      Alert.alert("Info", "Kategori sudah ada.");
      return;
    }
    const nextUser = { ...user, categories: [...(user?.categories || []), v] };
    await saveUser(nextUser);
    setNewCat("");
    setCategory(v);
  }, [newCat, user, saveUser]);

  const addWallet = useCallback(async () => {
    const w = (newWallet || "").trim();
    if (!w) return;
    if (user?.wallets?.[w]) {
      Alert.alert("Info", "Nama dompet sudah ada.");
      return;
    }
    const nextUser = {
      ...user,
      selectedWallet: w,
      wallets: { ...user.wallets, [w]: { balance: 0, transactions: [] } },
    };
    await saveUser(nextUser);
    setNewWallet("");
  }, [newWallet, user, saveUser]);

  const switchWallet = useCallback(
    async (name) => {
      if (!user?.wallets?.[name]) return;
      const nextUser = { ...user, selectedWallet: name };
      await saveUser(nextUser);
    },
    [user, saveUser]
  );

  const recent = useMemo(() => activeWallet.transactions.slice(0, 5), [activeWallet.transactions]);

  if (!user) return <View style={[styles.screenWrap, { backgroundColor: T.bg }]} />;

  return (
    <ScrollView
      style={[styles.screenWrap, { backgroundColor: T.bg }]}
      contentContainerStyle={{ paddingBottom: 24 }}
    >
      {/* Header */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.hi, { color: T.text }]}>Halo, {username} 👋</Text>
          <Text style={[styles.muted, { color: T.muted }]}>Kelola keuanganmu dengan rapi</Text>
        </View>
        <TouchableOpacity style={[styles.btnGraySm, { backgroundColor: T.chipBg }]} onPress={goProfile}>
          <Text style={[styles.btnText, { color: T.text }]}>Profil</Text>
        </TouchableOpacity>
      </View>

      {/* Wallet Picker */}
      <View style={[styles.card, { backgroundColor: T.card, borderColor: T.border }]}>
        <View style={styles.rowSpace}>
          <Text style={[styles.cardTitle, { color: T.text }]}>Dompet</Text>
          <TouchableOpacity onPress={goScheduler}>
            <Text style={[styles.link, { color: T.primary }]}>📅 Scheduler</Text>
          </TouchableOpacity>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }}>
          {Object.keys(user.wallets).map((w) => (
            <TouchableOpacity
              key={w}
              onPress={() => switchWallet(w)}
              style={
                w === activeWalletName
                  ? [styles.chipActive, { backgroundColor: T.chipBgActive }]
                  : [styles.chip, { backgroundColor: T.chipBg, borderColor: T.border }]
              }
            >
              <Text
                style={w === activeWalletName ? styles.chipTextActive : [styles.chipText, { color: T.text }]}
              >
                {w}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
        <View style={styles.row}>
          <TextInput
            placeholder="Tambah dompet baru"
            placeholderTextColor={T.muted}
            value={newWallet}
            onChangeText={setNewWallet}
            style={[styles.input, { backgroundColor: T.chipBg, borderColor: T.border, color: T.text }]}
          />
          <TouchableOpacity style={[styles.btnGhost, { borderColor: T.primary }]} onPress={addWallet}>
            <Text style={[styles.btnGhostText, { color: T.primary }]}>+ Tambah</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Balance Card */}
      <View
        style={[
          styles.balanceCard,
          { backgroundColor: T.card, borderColor: T.border, overflow: "hidden" },
        ]}
      >
        <View
          style={{
            position: "absolute",
            top: -60,
            right: -60,
            width: 180,
            height: 180,
            borderRadius: 180,
            backgroundColor: T.balanceGradB,
            opacity: 0.25,
          }}
        />
        <View
          style={{
            position: "absolute",
            bottom: -50,
            left: -50,
            width: 160,
            height: 160,
            borderRadius: 160,
            backgroundColor: T.balanceGradA,
            opacity: 0.25,
          }}
        />
        <Text style={[styles.balanceLabel, { color: T.muted }]}>Saldo {activeWalletName}</Text>
        <Text style={[styles.balanceValue, { color: T.text }]}>{currency(activeWallet.balance)}</Text>
      </View>

      {/* Input Transaksi */}
      <View style={[styles.card, { backgroundColor: T.card, borderColor: T.border }]}>
        <Text style={[styles.cardTitle, { color: T.text }]}>Tambah Transaksi</Text>

        <View style={styles.segmentRow}>
          <TouchableOpacity
            onPress={() => setType("out")}
            style={
              type === "out"
                ? [styles.segmentActive, { backgroundColor: T.primary }]
                : [styles.segment, { borderColor: T.primary, backgroundColor: T.card }]
            }
          >
            <Text style={type === "out" ? styles.segmentTextActive : [styles.segmentText, { color: T.primary }]}>
              Pengeluaran
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setType("in")}
            style={
              type === "in"
                ? [styles.segmentActive, { backgroundColor: T.primary }]
                : [styles.segment, { borderColor: T.primary, backgroundColor: T.card }]
            }
          >
            <Text style={type === "in" ? styles.segmentTextActive : [styles.segmentText, { color: T.primary }]}>
              Pemasukan
            </Text>
          </TouchableOpacity>
        </View>

        <TextInput
          placeholder="Jumlah (angka)"
          placeholderTextColor={T.muted}
          keyboardType="numeric"
          value={amount}
          onChangeText={setAmount}
          style={[styles.input, { backgroundColor: T.chipBg, borderColor: T.border, color: T.text }]}
        />

        <Text style={[styles.muted, { marginBottom: 6, color: T.muted }]}>Kategori</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }}>
          {(user.categories || []).map((c) => (
            <TouchableOpacity
              key={c}
              onPress={() => setCategory(c)}
              style={
                category === c
                  ? [styles.chipActive, { backgroundColor: T.chipBgActive }]
                  : [styles.chip, { backgroundColor: T.chipBg, borderColor: T.border }]
              }
            >
              <Text style={category === c ? styles.chipTextActive : [styles.chipText, { color: T.text }]}>
                {c}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <View style={styles.row}>
          <TextInput
            placeholder="Tambah kategori baru"
            placeholderTextColor={T.muted}
            value={newCat}
            onChangeText={setNewCat}
            style={[styles.input, { backgroundColor: T.chipBg, borderColor: T.border, color: T.text }]}
          />
          <TouchableOpacity style={[styles.btnGhost, { borderColor: T.primary }]} onPress={addCategory}>
            <Text style={[styles.btnGhostText, { color: T.primary }]}>+ Tambah</Text>
          </TouchableOpacity>
        </View>

        <TextInput
          placeholder="Catatan (opsional)"
          placeholderTextColor={T.muted}
          value={note}
          onChangeText={setNote}
          style={[styles.input, { backgroundColor: T.chipBg, borderColor: T.border, color: T.text, marginTop: 8 }]}
        />

        <TouchableOpacity style={[styles.btnPrimary, { backgroundColor: T.primary }]} onPress={addTransaction}>
          <Text style={styles.btnText}>
            {type === "out" ? "Catat Pengeluaran" : "Catat Pemasukan"}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Ringkasan Terbaru */}
      <View style={[styles.card, { backgroundColor: T.card, borderColor: T.border }]}>
        <View style={styles.rowSpace}>
          <Text style={[styles.cardTitle, { color: T.text }]}>Ringkasan Terbaru</Text>
          <TouchableOpacity onPress={goHistory}>
            <Text style={[styles.link, { color: T.primary }]}>Lihat Semua →</Text>
          </TouchableOpacity>
        </View>

        {recent.length === 0 ? (
          <Text style={[styles.muted, { color: T.muted }]}>Belum ada transaksi.</Text>
        ) : (
          recent.map((t) => (
            <View key={t.id} style={styles.txItem}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.txTitle, { color: T.text }]}>
                  {t.category} {t.note ? `• ${t.note}` : ""}
                </Text>
                <Text style={[styles.txSub, { color: T.muted }]}>{fmtDateTime(t.createdAtISO)}</Text>
              </View>
              <Text style={t.type === "in" ? [styles.amountIn, { color: T.success }] : [styles.amountOut, { color: T.danger }]}>
                {t.type === "in" ? "+" : "−"} {currency(t.amount)}
              </Text>
            </View>
          ))
        )}
      </View>
    </ScrollView>
  );
}

/* =============== History (List + Filter + Delete) =============== */
function HistoryScreen({ username, goBack }) {
  const [user, setUser] = useState(null);
  const [cat, setCat] = useState("Semua");
  const [from, setFrom] = useState(""); // YYYY-MM-DD
  const [to, setTo] = useState(""); // YYYY-MM-DD
  const [q, setQ] = useState("");

  const loadUser = useCallback(async () => {
    const usersData = await AsyncStorage.getItem("users");
    const users = usersData ? JSON.parse(usersData) : {};
    const u = users[username];
    if (u) setUser(u);
  }, [username]);

  useEffect(() => {
    loadUser();
  }, [loadUser]);

  const T = palette[user?.theme || "light"];
  const activeWalletName = user?.selectedWallet || "Dompet Utama";

  const allTx = useMemo(() => {
    const list = user?.wallets?.[activeWalletName]?.transactions || [];
    return Array.isArray(list) ? list : [];
  }, [user, activeWalletName]);

  const categories = useMemo(
    () => ["Semua", ...(user?.categories || [])],
    [user?.categories]
  );

  const filtered = useMemo(() => {
    return allTx.filter((t) => {
      if (cat !== "Semua" && t.category !== cat) return false;
      if (q) {
        const hay = `${t.category} ${t.note || ""}`.toLowerCase();
        if (!hay.includes(q.toLowerCase())) return false;
      }
      if (from) {
        const d = t.createdAtISO?.slice(0, 10);
        if (!d || d < from) return false;
      }
      if (to) {
        const d = t.createdAtISO?.slice(0, 10);
        if (!d || d > to) return false;
      }
      return true;
    });
  }, [allTx, cat, from, to, q]);

  const deleteTx = useCallback(
    async (txId) => {
      if (!user) return;
      const usersData = await AsyncStorage.getItem("users");
      const users = usersData ? JSON.parse(usersData) : {};
      const me = users[username];
      if (!me) return;
      const wallet = me.wallets[activeWalletName];
      const tx = wallet.transactions.find((x) => x.id === txId);
      if (!tx) return;

      const newBalance = tx.type === "in" ? wallet.balance - tx.amount : wallet.balance + tx.amount;
      const newTxs = wallet.transactions.filter((x) => x.id !== txId);

      me.wallets[activeWalletName] = { ...wallet, balance: newBalance, transactions: newTxs };
      users[username] = me;

      await AsyncStorage.setItem("users", JSON.stringify(users));
      setUser(me);
    },
    [user, username, activeWalletName]
  );

  return (
    <View style={[styles.screenWrap, { backgroundColor: T.bg }]}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={[styles.hi, { color: T.text }]}>Riwayat – {activeWalletName}</Text>
        <TouchableOpacity style={[styles.btnGraySm, { backgroundColor: T.chipBg }]} onPress={goBack}>
          <Text style={[styles.btnText, { color: T.text }]}>Tutup</Text>
        </TouchableOpacity>
      </View>

      {/* Filter Card */}
      <View style={[styles.card, { backgroundColor: T.card, borderColor: T.border }]}>
        <Text style={[styles.cardTitle, { color: T.text }]}>Filter</Text>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 6 }}>
          {categories.map((c) => (
            <TouchableOpacity
              key={c}
              onPress={() => setCat(c)}
              style={
                c === cat
                  ? [styles.chipActive, { backgroundColor: T.chipBgActive }]
                  : [styles.chip, { backgroundColor: T.chipBg, borderColor: T.border }]
              }
            >
              <Text style={c === cat ? styles.chipTextActive : [styles.chipText, { color: T.text }]}>{c}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <View style={styles.row}>
          <TextInput
            placeholder="Dari (YYYY-MM-DD)"
            placeholderTextColor={T.muted}
            value={from}
            onChangeText={setFrom}
            style={[styles.input, { backgroundColor: T.chipBg, borderColor: T.border, color: T.text }]}
          />
          <TextInput
            placeholder="Sampai (YYYY-MM-DD)"
            placeholderTextColor={T.muted}
            value={to}
            onChangeText={setTo}
            style={[styles.input, { backgroundColor: T.chipBg, borderColor: T.border, color: T.text }]}
          />
        </View>

        <TextInput
          placeholder="Cari (kategori/catatan)"
          placeholderTextColor={T.muted}
          value={q}
          onChangeText={setQ}
          style={[styles.input, { backgroundColor: T.chipBg, borderColor: T.border, color: T.text, marginTop: 8 }]}
        />
      </View>

      {/* List */}
      {filtered.length === 0 ? (
        <Text style={[styles.muted, { textAlign: "center", marginTop: 12, color: T.muted }]}>
          Tidak ada transaksi sesuai filter.
        </Text>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(it) => it.id}
          contentContainerStyle={{ paddingBottom: 20 }}
          renderItem={({ item }) => (
            <View style={[styles.listCard, { backgroundColor: T.card, borderColor: T.border }]}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.txTitle, { color: T.text }]}>
                  {item.category} {item.note ? `• ${item.note}` : ""}
                </Text>
                <Text style={[styles.txSub, { color: T.muted }]}>{fmtDateTime(item.createdAtISO)}</Text>
              </View>
              <Text style={item.type === "in" ? [styles.amountIn, { color: T.success }] : [styles.amountOut, { color: T.danger }]}>
                {item.type === "in" ? "+" : "−"} {currency(item.amount)}
              </Text>
              <TouchableOpacity
                onPress={() =>
                  Alert.alert(
                    "Hapus Transaksi",
                    "Yakin mau hapus transaksi ini?",
                    [
                      { text: "Batal", style: "cancel" },
                      { text: "Hapus", style: "destructive", onPress: () => deleteTx(item.id) },
                    ]
                  )
                }
                style={styles.btnDelete}
              >
                <Text style={{ color: "#fff", fontWeight: "800" }}>🗑</Text>
              </TouchableOpacity>
            </View>
          )}
        />
      )}
    </View>
  );
}

/* =============== Scheduler (Create/Edit List) =============== */
function SchedulerScreen({ username, goBack }) {
  const [user, setUser] = useState(null);

  // form
  const [type, setType] = useState("out"); // in | out
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("Tagihan");
  const [note, setNote] = useState("");
  const [wallet, setWallet] = useState("Dompet Utama");

  const [repeat, setRepeat] = useState("monthly"); // none | daily | weekly | monthly
  const [startDate, setStartDate] = useState(""); // YYYY-MM-DD
  const [timeHHmm, setTimeHHmm] = useState("09:00");

  const loadUser = useCallback(async () => {
    const usersData = await AsyncStorage.getItem("users");
    const users = usersData ? JSON.parse(usersData) : {};
    const u = users[username];
    if (u) {
      setUser(u);
      if (u.wallets && u.selectedWallet) setWallet(u.selectedWallet);
      await ensureNotifPermission(); // ask permission once here
      await ensureBackgroundTaskRegistered();
    }
  }, [username]);

  useEffect(() => {
    loadUser();
  }, [loadUser]);

  const T = palette[user?.theme || "light"];

  const saveUser = useCallback(
    async (next) => {
      const usersData = await AsyncStorage.getItem("users");
      const users = usersData ? JSON.parse(usersData) : {};
      users[username] = next;
      await AsyncStorage.setItem("users", JSON.stringify(users));
      setUser(next);
    },
    [username]
  );

  const createSchedule = useCallback(async () => {
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt <= 0) {
      Alert.alert("Invalid", "Jumlah harus angka > 0.");
      return;
    }
    if (!startDate || !timeHHmm) {
      Alert.alert("Invalid", "Tanggal mulai & jam wajib diisi (YYYY-MM-DD & HH:mm).");
      return;
    }
    const [hh, mm] = timeHHmm.split(":").map((x) => parseInt(x));
    const [Y, M, D] = startDate.split("-").map((x) => parseInt(x));
    const firstRun = new Date(Y, (M || 1) - 1, D || 1, hh || 9, mm || 0, 0);

    const sched = {
      id: uid(),
      type,
      amount: amt,
      category,
      note,
      wallet,
      repeat, // none | daily | weekly | monthly
      startDate,
      timeHHmm,
      nextRunISO: firstRun.toISOString(),
      completed: false,
      createdAtISO: new Date().toISOString(),
    };

    const nextUser = { ...user, schedules: [sched, ...(user?.schedules || [])] };
    await saveUser(nextUser);

    // Schedule local notification for first run (nice-to-have; background task will also handle)
    await scheduleLocalNotification({
      title: repeat === "none" ? "Pengingat Transaksi" : "Transaksi Terjadwal",
      body:
        (type === "in" ? "Pemasukan" : "Pengeluaran") +
        ` • ${category} ${note ? `(${note})` : ""} — ${currency(amt)} • ${wallet}`,
      date: firstRun,
    });

    setAmount("");
    setNote("");
    Alert.alert("Sukses", "Jadwal transaksi dibuat.");
  }, [amount, type, category, note, wallet, repeat, startDate, timeHHmm, user, saveUser]);

  const deleteSchedule = useCallback(
    async (id) => {
      const next = { ...user, schedules: (user?.schedules || []).filter((s) => s.id !== id) };
      await saveUser(next);
    },
    [user, saveUser]
  );

  if (!user) return <View style={[styles.screenWrap, { backgroundColor: "#F6F8FC" }]} />;

  const schedules = user.schedules || [];

  return (
    <ScrollView
      style={[styles.screenWrap, { backgroundColor: T.bg }]}
      contentContainerStyle={{ paddingBottom: 24 }}
    >
      {/* Header */}
      <View style={styles.header}>
        <Text style={[styles.hi, { color: T.text }]}>📅 Scheduler</Text>
        <TouchableOpacity style={[styles.btnGraySm, { backgroundColor: T.chipBg }]} onPress={goBack}>
          <Text style={[styles.btnText, { color: T.text }]}>Tutup</Text>
        </TouchableOpacity>
      </View>

      {/* Form */}
      <View style={[styles.card, { backgroundColor: T.card, borderColor: T.border }]}>
        <Text style={[styles.cardTitle, { color: T.text }]}>Buat Jadwal Transaksi</Text>

        <View style={styles.segmentRow}>
          <TouchableOpacity
            onPress={() => setType("out")}
            style={
              type === "out"
                ? [styles.segmentActive, { backgroundColor: T.primary }]
                : [styles.segment, { borderColor: T.primary, backgroundColor: T.card }]
            }
          >
            <Text style={type === "out" ? styles.segmentTextActive : [styles.segmentText, { color: T.primary }]}>
              Pengeluaran
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setType("in")}
            style={
              type === "in"
                ? [styles.segmentActive, { backgroundColor: T.primary }]
                : [styles.segment, { borderColor: T.primary, backgroundColor: T.card }]
            }
          >
            <Text style={type === "in" ? styles.segmentTextActive : [styles.segmentText, { color: T.primary }]}>
              Pemasukan
            </Text>
          </TouchableOpacity>
        </View>

        <TextInput
          placeholder="Jumlah (angka)"
          keyboardType="numeric"
          value={amount}
          onChangeText={setAmount}
          placeholderTextColor={T.muted}
          style={[styles.input, { backgroundColor: T.chipBg, borderColor: T.border, color: T.text }]}
        />

        <View style={styles.row}>
          <TextInput
            placeholder="Kategori (cth: Tagihan)"
            value={category}
            onChangeText={setCategory}
            placeholderTextColor={T.muted}
            style={[styles.input, { backgroundColor: T.chipBg, borderColor: T.border, color: T.text }]}
          />
          <TextInput
            placeholder="Dompet (pilih nama)"
            value={wallet}
            onChangeText={setWallet}
            placeholderTextColor={T.muted}
            style={[styles.input, { backgroundColor: T.chipBg, borderColor: T.border, color: T.text }]}
          />
        </View>

        <TextInput
          placeholder="Catatan (opsional)"
          value={note}
          onChangeText={setNote}
          placeholderTextColor={T.muted}
          style={[styles.input, { backgroundColor: T.chipBg, borderColor: T.border, color: T.text, marginTop: 8 }]}
        />

        <View style={styles.row}>
          <TextInput
            placeholder="Tanggal Mulai (YYYY-MM-DD)"
            value={startDate}
            onChangeText={setStartDate}
            placeholderTextColor={T.muted}
            style={[styles.input, { backgroundColor: T.chipBg, borderColor: T.border, color: T.text }]}
          />
          <TextInput
            placeholder="Jam (HH:mm)"
            value={timeHHmm}
            onChangeText={setTimeHHmm}
            placeholderTextColor={T.muted}
            style={[styles.input, { backgroundColor: T.chipBg, borderColor: T.border, color: T.text }]}
          />
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }}>
          {[
            { key: "none", label: "Sekali" },
            { key: "daily", label: "Harian" },
            { key: "weekly", label: "Mingguan" },
            { key: "monthly", label: "Bulanan" },
          ].map((r) => (
            <TouchableOpacity
              key={r.key}
              onPress={() => setRepeat(r.key)}
              style={
                repeat === r.key
                  ? [styles.chipActive, { backgroundColor: T.chipBgActive }]
                  : [styles.chip, { backgroundColor: T.chipBg, borderColor: T.border }]
              }
            >
              <Text style={repeat === r.key ? styles.chipTextActive : [styles.chipText, { color: T.text }]}>
                {r.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <TouchableOpacity style={[styles.btnPrimary, { backgroundColor: T.primary, marginTop: 10 }]} onPress={createSchedule}>
          <Text style={styles.btnText}>Simpan Jadwal</Text>
        </TouchableOpacity>
      </View>

      {/* List Jadwal */}
      <View style={[styles.card, { backgroundColor: T.card, borderColor: T.border }]}>
        <View style={styles.rowSpace}>
          <Text style={[styles.cardTitle, { color: T.text }]}>Daftar Jadwal</Text>
          <Text style={[styles.muted, { color: T.muted }]}>{schedules.length} item</Text>
        </View>

        {schedules.length === 0 ? (
          <Text style={[styles.muted, { color: T.muted }]}>Belum ada jadwal.</Text>
        ) : (
          schedules.map((s) => (
            <View key={s.id} style={[styles.listCard, { backgroundColor: T.card, borderColor: T.border }]}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.txTitle, { color: T.text }]}>
                  {s.repeat === "none" ? "Sekali" : s.repeat.toUpperCase()} •{" "}
                  {s.type === "in" ? "Pemasukan" : "Pengeluaran"} • {s.category} • {s.wallet}
                </Text>
                <Text style={[styles.txSub, { color: T.muted }]}>
                  Mulai: {s.startDate} {s.timeHHmm} | {s.completed ? "✅ Selesai" : `Next: ${fmtDateTime(s.nextRunISO)}`}
                </Text>
              </View>
              <Text style={s.type === "in" ? [styles.amountIn, { color: T.success }] : [styles.amountOut, { color: T.danger }]}>
                {s.type === "in" ? "+" : "−"} {currency(s.amount)}
              </Text>
              <TouchableOpacity
                onPress={() =>
                  Alert.alert("Hapus Jadwal", "Yakin hapus jadwal ini?", [
                    { text: "Batal", style: "cancel" },
                    { text: "Hapus", style: "destructive", onPress: () => deleteSchedule(s.id) },
                  ])
                }
                style={styles.btnDelete}
              >
                <Text style={{ color: "#fff", fontWeight: "800" }}>🗑</Text>
              </TouchableOpacity>
            </View>
          ))
        )}
      </View>
    </ScrollView>
  );
}

/* =============== Profile (Theme + Wallets + Reset + Logout) =============== */
function ProfileScreen({ username, onLogout, goBack }) {
  const [user, setUser] = useState(null);
  const [newWallet, setNewWallet] = useState("");

  const loadUser = useCallback(async () => {
    const usersData = await AsyncStorage.getItem("users");
    const users = usersData ? JSON.parse(usersData) : {};
    const u = users[username];
    if (u) setUser(u);
  }, [username]);

  useEffect(() => {
    loadUser();
  }, [loadUser]);

  const T = palette[user?.theme || "light"];

  const saveUser = useCallback(
    async (next) => {
      const usersData = await AsyncStorage.getItem("users");
      const users = usersData ? JSON.parse(usersData) : {};
      users[username] = next;
      await AsyncStorage.setItem("users", JSON.stringify(users));
      setUser(next);
    },
    [username]
  );

  const switchWallet = useCallback(
    async (name) => {
      const usersData = await AsyncStorage.getItem("users");
      const users = usersData ? JSON.parse(usersData) : {};
      if (!users[username]?.wallets?.[name]) return;
      users[username].selectedWallet = name;
      await AsyncStorage.setItem("users", JSON.stringify(users));
      setUser(users[username]);
      Alert.alert("Sukses", `Dompet aktif: ${name}`);
    },
    [username]
  );

  const addWallet = useCallback(async () => {
    const w = (newWallet || "").trim();
    if (!w) return;
    const usersData = await AsyncStorage.getItem("users");
    const users = usersData ? JSON.parse(usersData) : {};
    if (users[username]?.wallets?.[w]) {
      Alert.alert("Info", "Nama dompet sudah ada.");
      return;
    }
    users[username].wallets[w] = { balance: 0, transactions: [] };
    users[username].selectedWallet = w;
    await AsyncStorage.setItem("users", JSON.stringify(users));
    setNewWallet("");
    setUser(users[username]);
  }, [newWallet, username]);

  const deleteWallet = useCallback(
    async (name) => {
      if (name === "Dompet Utama") {
        Alert.alert("Gagal", "Dompet Utama tidak bisa dihapus.");
        return;
      }
      Alert.alert(
        "Hapus Dompet",
        `Hapus dompet "${name}"? Semua transaksi di dompet ini akan hilang.`,
        [
          { text: "Batal", style: "cancel" },
          {
            text: "Hapus",
            style: "destructive",
            onPress: async () => {
              const usersData = await AsyncStorage.getItem("users");
              const users = usersData ? JSON.parse(usersData) : {};
              if (!users[username]?.wallets?.[name]) return;

              if (users[username].selectedWallet === name) {
                const remaining = Object.keys(users[username].wallets).filter((w) => w !== name);
                const nextActive = remaining.includes("Dompet Utama")
                  ? "Dompet Utama"
                  : remaining[0] || "Dompet Utama";
                users[username].selectedWallet = nextActive;
              }

              delete users[username].wallets[name];
              await AsyncStorage.setItem("users", JSON.stringify(users));
              setUser(users[username]);
            },
          },
        ]
      );
    },
    [username]
  );

  const resetAll = useCallback(async () => {
    Alert.alert("Reset Data", "Semua dompet & transaksi akan dihapus. Lanjut?", [
      { text: "Batal", style: "cancel" },
      {
        text: "Reset",
        style: "destructive",
        onPress: async () => {
          const usersData = await AsyncStorage.getItem("users");
          const users = usersData ? JSON.parse(usersData) : {};
          users[username].wallets = { "Dompet Utama": { balance: 0, transactions: [] } };
          users[username].selectedWallet = "Dompet Utama";
          users[username].schedules = [];
          await AsyncStorage.setItem("users", JSON.stringify(users));
          setUser(users[username]);
        },
      },
    ]);
  }, [username]);

  const toggleTheme = useCallback(async () => {
    const nextTheme = (user?.theme || "light") === "light" ? "dark" : "light";
    const next = { ...user, theme: nextTheme };
    await saveUser(next);
  }, [user, saveUser]);

  if (!user) return <View style={[styles.screenWrap, { backgroundColor: "#F6F8FC" }]} />;

  const walletEntries = Object.entries(user.wallets);
  return (
    <ScrollView
      style={[styles.screenWrap, { backgroundColor: T.bg }]}
      contentContainerStyle={{ paddingBottom: 24 }}
    >
      {/* Header */}
      <View className="header" style={styles.header}>
        <Text style={[styles.hi, { color: T.text }]}>Profil</Text>
        <TouchableOpacity style={[styles.btnGraySm, { backgroundColor: T.chipBg }]} onPress={goBack}>
          <Text style={[styles.btnText, { color: T.text }]}>Tutup</Text>
        </TouchableOpacity>
      </View>

      {/* Theme */}
      <View style={[styles.card, { backgroundColor: T.card, borderColor: T.border }]}>
        <View style={styles.rowSpace}>
          <Text style={[styles.cardTitle, { color: T.text }]}>Tema</Text>
          <TouchableOpacity
            onPress={toggleTheme}
            style={[styles.btnGhost, { borderColor: T.primary }]}
          >
            <Text style={[styles.btnGhostText, { color: T.primary }]}>
              Toggle: {user.theme === "dark" ? "Dark" : "Light"}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Wallet Overview */}
      <View style={[styles.card, { backgroundColor: T.card, borderColor: T.border }]}>
        <Text style={[styles.cardTitle, { color: T.text }]}>Dompet & Saldo</Text>
        {walletEntries.map(([name, w]) => (
          <View key={name} style={styles.walletRow}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.walletName, { color: T.text }]}>{name}</Text>
              <Text style={[styles.mutedSmall, { color: T.muted }]}>Saldo</Text>
            </View>
            <Text style={[styles.walletBalance, { color: T.text }]}>{currency(w.balance)}</Text>

            <TouchableOpacity
              onPress={() => switchWallet(name)}
              style={
                name === user.selectedWallet
                  ? [styles.btnSelectActive, { backgroundColor: T.primary }]
                  : [styles.btnSelect, { borderColor: T.border }]
              }
            >
              <Text
                style={
                  name === user.selectedWallet
                    ? styles.btnSelectTextActive
                    : [styles.btnSelectText, { color: T.text }]
                }
              >
                {name === user.selectedWallet ? "Aktif" : "Pilih"}
              </Text>
            </TouchableOpacity>

            {name !== "Dompet Utama" && (
              <TouchableOpacity style={styles.btnDeleteSm} onPress={() => deleteWallet(name)}>
                <Text style={{ color: "#fff", fontWeight: "800" }}>🗑</Text>
              </TouchableOpacity>
            )}
          </View>
        ))}
      </View>

      {/* Add Wallet */}
      <View style={[styles.card, { backgroundColor: T.card, borderColor: T.border }]}>
        <Text style={[styles.cardTitle, { color: T.text }]}>Tambah Dompet</Text>
        <View style={styles.row}>
          <TextInput
            placeholder="Nama dompet baru"
            value={newWallet}
            onChangeText={setNewWallet}
            placeholderTextColor={T.muted}
            style={[styles.input, { backgroundColor: T.chipBg, borderColor: T.border, color: T.text }]}
          />
          <TouchableOpacity style={[styles.btnGhost, { borderColor: T.primary }]} onPress={addWallet}>
            <Text style={[styles.btnGhostText, { color: T.primary }]}>+ Tambah</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Danger Zone */}
      <View style={styles.cardDanger}>
        <Text style={styles.cardTitleWhite}>Reset Data</Text>
        <Text style={styles.cardSubWhite}>Hapus semua dompet, transaksi, & jadwal (akun tetap ada).</Text>
        <TouchableOpacity style={styles.btnDanger} onPress={resetAll}>
          <Text style={styles.btnText}>Reset</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity style={[styles.btnGray, { backgroundColor: "#4b5563" }]} onPress={onLogout}>
        <Text style={styles.btnText}>Logout</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

/* =============== App Root (Screens) =============== */
export default function App() {
  const [screen, setScreen] = useState("loading"); // loading | auth | home | history | profile | scheduler
  const [me, setMe] = useState(null);

  useEffect(() => {
    (async () => {
      const u = await AsyncStorage.getItem("loggedInUser");
      if (u) {
        setMe(u);
        setScreen("home");
        await ensureNotifPermission();
        await ensureBackgroundTaskRegistered();
      } else {
        setScreen("auth");
      }
    })();
  }, []);

  if (screen === "loading") return null;
  if (screen === "auth") return <AuthScreen onAuthed={(u) => { setMe(u); setScreen("home"); }} />;

  if (screen === "home")
    return (
      <HomeScreen
        username={me}
        goHistory={() => setScreen("history")}
        goProfile={() => setScreen("profile")}
        goScheduler={() => setScreen("scheduler")}
      />
    );

  if (screen === "history") return <HistoryScreen username={me} goBack={() => setScreen("home")} />;

  if (screen === "scheduler")
    return <SchedulerScreen username={me} goBack={() => setScreen("home")} />;

  if (screen === "profile")
    return (
      <ProfileScreen
        username={me}
        goBack={() => setScreen("home")}
        onLogout={async () => {
          await AsyncStorage.removeItem("loggedInUser");
          setMe(null);
          setScreen("auth");
        }}
      />
    );

  return null;
}

/* =============== Styles =============== */
const shadow = Platform.select({
  ios: { shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } },
  android: { elevation: 3 },
});

const styles = StyleSheet.create({
  screenWrap: { flex: 1, padding: 16, paddingTop: Platform.OS === "android" ? 28 : 16 },
  header: { flexDirection: "row", alignItems: "center", marginBottom: 10 },
  hi: { fontSize: 20, fontWeight: "700" },
  muted: { color: "#6B7280" },
  mutedSmall: { color: "#6B7280", fontSize: 12 },

  /* Segments / Chips */
  segmentRow: { flexDirection: "row", gap: 10, marginBottom: 12, alignSelf: "stretch" },
  segment: {
    flex: 1,
    borderWidth: 1,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: "center",
    backgroundColor: "#fff",
  },
  segmentActive: {
    flex: 1,
    borderRadius: 10,
    alignItems: "center",
    paddingVertical: 10,
    ...shadow,
  },
  segmentText: { fontWeight: "700" },
  segmentTextActive: { color: "#fff", fontWeight: "800" },

  chip: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderRadius: 999,
    marginRight: 8,
    backgroundColor: "#F3F4F6",
  },
  chipActive: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
    marginRight: 8,
  },
  chipText: { color: "#1f2937", fontWeight: "600" },
  chipTextActive: { color: "#fff", fontWeight: "700" },

  /* Cards */
  card: {
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 12,
    marginTop: 12,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    ...shadow,
  },
  listCard: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 12,
    marginHorizontal: 16,
    marginTop: 10,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    ...shadow,
  },
  balanceCard: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 16,
    marginTop: 12,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    ...shadow,
  },
  balanceLabel: { fontSize: 14 },
  balanceValue: { fontSize: 30, fontWeight: "800", marginTop: 4 },

  cardTitle: { fontSize: 16, fontWeight: "700", marginBottom: 6 },
  cardDanger: {
    backgroundColor: "#0F172A",
    borderRadius: 14,
    padding: 14,
    marginTop: 12,
    ...shadow,
  },
  cardTitleWhite: { color: "#fff", fontSize: 16, fontWeight: "700", marginBottom: 6 },
  cardSubWhite: { color: "#cbd5e1", marginBottom: 8 },

  /* Inputs & Buttons */
  input: {
    backgroundColor: "#F0F3F8",
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    flex: 1,
  },
  row: { flexDirection: "row", gap: 8, marginTop: 8, alignItems: "center" },
  rowSpace: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },

  btnPrimary: { backgroundColor: "#635BFF", padding: 12, borderRadius: 10, alignItems: "center", marginTop: 10 },
  btnSuccess: { backgroundColor: "#22C55E", padding: 12, borderRadius: 10, alignItems: "center", marginTop: 10 },
  btnDanger: { backgroundColor: "#EF4444", padding: 12, borderRadius: 10, alignItems: "center", marginTop: 10 },
  btnGray: { backgroundColor: "#4b5563", padding: 12, borderRadius: 10, alignItems: "center", marginTop: 12 },
  btnGraySm: { backgroundColor: "#E5E7EB", paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10 },
  btnGhost: {
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  btnGhostText: { fontWeight: "700" },
  btnSelect: {
    borderWidth: 1,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    marginLeft: 8,
  },
  btnSelectActive: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    marginLeft: 8,
  },
  btnSelectText: { fontWeight: "700" },
  btnSelectTextActive: { color: "#fff", fontWeight: "800" },

  btnText: { color: "#fff", fontWeight: "700" },
  link: { fontWeight: "700" },

  /* Tx item */
  txItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    borderTopWidth: 1,
    borderColor: "#F1F5F9",
  },
  txTitle: { fontWeight: "700" },
  txSub: { fontSize: 12, marginTop: 2 },
  amountIn: { fontWeight: "800" },
  amountOut: { fontWeight: "800" },

  /* Wallet rows (profile) */
  walletRow: {
    flexDirection: "row",
    alignItems: "center",
    borderTopWidth: 1,
    borderColor: "#F1F5F9",
    paddingVertical: 12,
  },
  walletName: { fontWeight: "700" },
  walletBalance: { fontWeight: "800", marginRight: 8 },

  /* Delete buttons */
  btnDelete: {
    backgroundColor: "#EF4444",
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
    marginLeft: 8,
  },
  btnDeleteSm: {
    backgroundColor: "#EF4444",
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 8,
    marginLeft: 8,
  },
});

/* =============== Styles: Auth =============== */
const stylesAuth = StyleSheet.create({
  wrap: { flex: 1, justifyContent: "center", alignItems: "center", padding: 20, backgroundColor: "#0F172A" },
  brand: { fontSize: 30, fontWeight: "900", color: "#FFFFFF", marginBottom: 16 },
  segmentRow: { flexDirection: "row", gap: 10, marginBottom: 12, alignSelf: "stretch", paddingHorizontal: 16 },
  segment: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#7C83FF",
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: "center",
    backgroundColor: "transparent",
  },
  segmentActive: {
    flex: 1,
    backgroundColor: "#7C83FF",
    borderRadius: 10,
    alignItems: "center",
    paddingVertical: 10,
  },
  segmentText: { color: "#7C83FF", fontWeight: "700" },
  segmentTextActive: { color: "#fff", fontWeight: "800" },
  input: {
    backgroundColor: "#141A2B",
    color: "#fff",
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: "#222A43",
    alignSelf: "stretch",
    marginHorizontal: 16,
    marginVertical: 6,
  },
  btnPrimary: {
    backgroundColor: "#7C83FF",
    padding: 12,
    borderRadius: 10,
    alignItems: "center",
    marginTop: 10,
    alignSelf: "stretch",
    marginHorizontal: 16,
  },
  btnSuccess: {
    backgroundColor: "#22C55E",
    padding: 12,
    borderRadius: 10,
    alignItems: "center",
    marginTop: 10,
    alignSelf: "stretch",
    marginHorizontal: 16,
  },
  btnText: { color: "#fff", fontWeight: "800" },
});
