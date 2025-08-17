import React, { useState, useEffect } from "react";
import { View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet, Alert, ImageBackground, Switch, LinearGradient } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { NavigationContainer, DefaultTheme, DarkTheme } from "@react-navigation/native";
import { createStackNavigator } from "@react-navigation/stack";
import DateTimePicker from "@react-native-community/datetimepicker";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient as ExpoLinearGradient } from 'expo-linear-gradient';

const Stack = createStackNavigator();

function GradientBackground({ children, colors }) {
  return (
    <ExpoLinearGradient colors={colors} style={{ flex: 1 }}>
      {children}
    </ExpoLinearGradient>
  );
}

function LoginScreen({ navigation }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const handleLogin = () => {
    if (username && password) {
      navigation.replace("Input");
    } else {
      Alert.alert("Login Gagal", "Isi username dan password terlebih dahulu");
    }
  };

  return (
    <GradientBackground colors={["#dbeafe", "#eff6ff"]}>
      <View style={styles.containerCenter}>
        <Ionicons name="wallet" size={64} color="#3b82f6" style={{ marginBottom: 10 }} />
        <Text style={styles.title}>Monitor Uang Bulanan</Text>
        <TextInput
          placeholder="Username"
          value={username}
          onChangeText={setUsername}
          style={styles.input}
        />
        <TextInput
          placeholder="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          style={styles.input}
        />
        <TouchableOpacity style={styles.button} onPress={handleLogin}>
          <Text style={styles.buttonText}>Login</Text>
        </TouchableOpacity>
      </View>
    </GradientBackground>
  );
}

function InputScreen({ navigation }) {
  const [transactions, setTransactions] = useState([]);
  const [desc, setDesc] = useState("");
  const [amount, setAmount] = useState("");
  const [type, setType] = useState("income");

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    saveData();
  }, [transactions]);

  const saveData = async () => {
    try {
      await AsyncStorage.setItem("transactions", JSON.stringify(transactions));
    } catch (e) {
      console.log("Error saving data", e);
    }
  };

  const loadData = async () => {
    try {
      const data = await AsyncStorage.getItem("transactions");
      if (data !== null) {
        setTransactions(JSON.parse(data));
      }
    } catch (e) {
      console.log("Error loading data", e);
    }
  };

  const addTransaction = () => {
    if (!desc || !amount) return;
    const newTransaction = {
      id: Date.now().toString(),
      desc,
      amount: parseFloat(amount),
      type,
      date: new Date().toISOString(),
    };
    setTransactions([newTransaction, ...transactions]);
    setDesc("");
    setAmount("");
  };

  const getTotal = (t) => {
    return transactions
      .filter((x) => x.type === t)
      .reduce((sum, item) => sum + item.amount, 0);
  };

  const saldo = getTotal("income") - getTotal("expense");

  return (
    <GradientBackground colors={["#f0fdfa", "#ecfdf5"]}>
      <View style={[styles.container, { backgroundColor: "rgba(255,255,255,0.92)", borderRadius: 16, marginVertical: 30 }]}> 
        <Text style={styles.header}>Halo, Selamat Datang!</Text>
        <View style={styles.card}>
          <Ionicons name="cash" size={28} color="#16a34a" style={{ marginBottom: 6 }} />
          <Text style={styles.cardText}>Saldo: Rp {saldo}</Text>
          <Text style={{ color: "green" }}>Pemasukan: Rp {getTotal("income")}</Text>
          <Text style={{ color: "red" }}>Pengeluaran: Rp {getTotal("expense")}</Text>
        </View>

        <TextInput
          placeholder="Deskripsi"
          value={desc}
          onChangeText={setDesc}
          style={styles.input}
        />
        <TextInput
          placeholder="Jumlah"
          value={amount}
          keyboardType="numeric"
          onChangeText={setAmount}
          style={styles.input}
        />

        <View style={styles.row}>
          <TouchableOpacity
            style={[styles.typeButton, type === "income" && { backgroundColor: "#22c55e" }]}
            onPress={() => setType("income")}
          >
            <Ionicons name="arrow-up-circle" size={18} color="#fff" />
            <Text style={[styles.typeText, { color: "#fff" }]}>Pemasukan</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.typeButton, type === "expense" && { backgroundColor: "#ef4444" }]}
            onPress={() => setType("expense")}
          >
            <Ionicons name="arrow-down-circle" size={18} color="#fff" />
            <Text style={[styles.typeText, { color: "#fff" }]}>Pengeluaran</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.button} onPress={addTransaction}>
          <Text style={styles.buttonText}>Tambah</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, { backgroundColor: "#3b82f6" }]}
          onPress={() => navigation.navigate("Riwayat")}
        >
          <Text style={styles.buttonText}>Lihat Riwayat</Text>
        </TouchableOpacity>
      </View>
    </GradientBackground>
  );
}

function RiwayatScreen() {
  const [transactions, setTransactions] = useState([]);
  const [filterDate, setFilterDate] = useState(new Date());
  const [showPicker, setShowPicker] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const data = await AsyncStorage.getItem("transactions");
      if (data !== null) {
        setTransactions(JSON.parse(data));
      }
    } catch (e) {
      console.log("Error loading data", e);
    }
  };

  const filteredTransactions = transactions.filter((item) => {
    const itemDate = new Date(item.date);
    return (
      itemDate.getMonth() === filterDate.getMonth() &&
      itemDate.getFullYear() === filterDate.getFullYear() &&
      itemDate.getDate() === filterDate.getDate()
    );
  });

  const totalIncome = filteredTransactions
    .filter((x) => x.type === "income")
    .reduce((sum, item) => sum + item.amount, 0);
  const totalExpense = filteredTransactions
    .filter((x) => x.type === "expense")
    .reduce((sum, item) => sum + item.amount, 0);

  return (
    <GradientBackground colors={["#fef2f2", "#fff7ed"]}>
      <View style={[styles.container, { backgroundColor: "rgba(249,250,251,0.9)", borderRadius: 16, marginVertical: 30 }]}> 
        <Text style={styles.header}>Riwayat Transaksi</Text>
        <TouchableOpacity style={styles.button} onPress={() => setShowPicker(true)}>
          <Text style={styles.buttonText}>Pilih Tanggal</Text>
        </TouchableOpacity>
        {showPicker && (
          <DateTimePicker
            value={filterDate}
            mode="date"
            display="default"
            onChange={(event, selectedDate) => {
              setShowPicker(false);
              if (selectedDate) setFilterDate(selectedDate);
            }}
          />
        )}

        <View style={styles.summaryCard}>
          <Text style={[styles.summaryText, { color: "#16a34a" }]}>Pemasukan: Rp {totalIncome}</Text>
          <Text style={[styles.summaryText, { color: "#dc2626" }]}>Pengeluaran: Rp {totalExpense}</Text>
          <Text style={[styles.summaryText, { color: "#2563eb" }]}>Saldo: Rp {totalIncome - totalExpense}</Text>
        </View>

        <FlatList
          data={filteredTransactions}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <View
              style={[
                styles.listItem,
                item.type === "income"
                  ? { backgroundColor: "#ecfdf5", borderLeftWidth: 5, borderLeftColor: "#16a34a" }
                  : { backgroundColor: "#fef2f2", borderLeftWidth: 5, borderLeftColor: "#dc2626" },
              ]}
            >
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <Ionicons
                  name={item.type === "income" ? "arrow-up-circle" : "arrow-down-circle"}
                  size={22}
                  color={item.type === "income" ? "#16a34a" : "#dc2626"}
                  style={{ marginRight: 8 }}
                />
                <View>
                  <Text style={styles.listText}>{item.desc}</Text>
                  <Text style={styles.listDate}>
                    {new Date(item.date).toLocaleDateString()} - {new Date(item.date).toLocaleTimeString()}
                  </Text>
                </View>
              </View>
              <Text
                style={{
                  color: item.type === "income" ? "#16a34a" : "#dc2626",
                  fontWeight: "bold",
                }}
              >
                {item.type === "income" ? "+" : "-"}Rp {item.amount}
              </Text>
            </View>
          )}
          ItemSeparatorComponent={() => (
            <View style={{ height: 1, backgroundColor: "#d1d5db", marginVertical: 4, opacity: 0.6 }} />
          )}
          ListEmptyComponent={() => (
            <Text style={{ textAlign: "center", marginTop: 20, color: "#6b7280" }}>
              Tidak ada transaksi pada tanggal ini.
            </Text>
          )}
        />
      </View>
    </GradientBackground>
  );
}

export default function App() {
  const [isDark, setIsDark] = useState(false);

  return (
    <NavigationContainer theme={isDark ? DarkTheme : DefaultTheme}>
      <View style={{ position: "absolute", top: 40, right: 20, zIndex: 1000, flexDirection: "row", alignItems: "center", backgroundColor: "rgba(255,255,255,0.8)", borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 }}>
        <Ionicons name={isDark ? "moon" : "sunny"} size={20} color={isDark ? "#facc15" : "#f59e0b"} />
        <Switch value={isDark} onValueChange={setIsDark} />
      </View>
      <Stack.Navigator initialRouteName="Login">
        <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
        <Stack.Screen name="Input" component={InputScreen} options={{ title: "Dashboard" }} />
        <Stack.Screen name="Riwayat" component={RiwayatScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  bg: {
    flex: 1,
    resizeMode: "cover",
  },
  container: {
    flex: 1,
    padding: 20,
    justifyContent: "flex-start",
  },
  containerCenter: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
    backgroundColor: "rgba(255,255,255,0.9)",
    borderRadius: 16,
    margin: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: "bold",
    marginBottom: 20,
    color: "#111827",
    textAlign: "center",
  },
  header: {
    fontSize: 22,
    fontWeight: "bold",
    marginBottom: 15,
    color: "#111827",
    textAlign: "center",
  },
  input: {
    borderWidth: 1,
    borderColor: "#d1d5db",
    marginBottom: 12,
    padding: 10,
    borderRadius: 10,
    backgroundColor: "#fff",
    width: "100%",
  },
  button: {
    backgroundColor: "#22c55e",
    padding: 12,
    borderRadius: 12,
    alignItems: "center",
    marginVertical: 6,
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
    flexDirection: "row",
    justifyContent: "center",
  },
  buttonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "bold",
    marginLeft: 6,
  },
  card: {
    backgroundColor: "#fff",
    padding: 15,
    borderRadius: 14,
    marginBottom: 20,
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 5,
    elevation: 3,
  },
  cardText: {
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 5,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginVertical: 8,
  },
  typeButton: {
    flex: 1,
    padding: 12,
    marginHorizontal: 4,
    borderRadius: 12,
    backgroundColor: "#e5e7eb",
    alignItems: "center",
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
    flexDirection: "row",
    justifyContent: "center",
  },
  typeText: {
    fontWeight: "bold",
    color: "#111827",
    marginLeft: 6,
  },
  listItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 14,
    marginVertical: 6,
    borderRadius: 12,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  listText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#111827",
  },
  listDate: {
    fontSize: 12,
    color: "#6b7280",
    marginTop: 2,
  },
  summaryCard: {
    backgroundColor: "#f9fafb",
    padding: 15,
    borderRadius: 14,
    marginVertical: 10,
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 5,
    elevation: 3,
  },
  summaryText: {
    fontSize: 16,
    fontWeight: "600",
    marginVertical: 2,
  },
});
