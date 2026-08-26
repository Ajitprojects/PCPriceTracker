import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";

import {
  ScrollView,
  StyleSheet,
  Text,
  View,
  StatusBar,
  ActivityIndicator,
  Pressable,
  Dimensions,
  TextInput,
  Modal,
  Platform,
  RefreshControl,
  Share,
  Alert,
} from "react-native";

import { LineChart } from "react-native-chart-kit";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";

import { supabase } from "./lib/supabase";

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

async function ensureNotificationPermission() {
  if (!Device.isDevice) {
    return false;
  }

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync(
      "default",
      {
        name: "Price Alerts",
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 150, 250],
        sound: "default",
      }
    );
  }

  const current = await Notifications.getPermissionsAsync();
  let status = current.status;

  if (status !== "granted") {
    const requested = await Notifications.requestPermissionsAsync();
    status = requested.status;
  }

  return status === "granted";
}

async function sendTargetHitNotification(
  productName: string,
  currentPrice: number,
  targetPrice: number
) {
  const allowed = await ensureNotificationPermission();

  if (!allowed) {
    return;
  }

  await Notifications.scheduleNotificationAsync({
    content: {
      title: "🎯 Price Target Hit",
      body: `${productName} is now ${formatPrice(
        currentPrice
      )} • Target ${formatPrice(targetPrice)}`,
      sound: "default",
      data: {
        type: "price-target-hit",
        currentPrice,
        targetPrice,
      },
    },
    trigger: null,
  });
}


type SupportedStore = {
  name: string;
  domain: string;
};

const SUPPORTED_STORES: SupportedStore[] = [
  { name: "MDComputers", domain: "mdcomputers.in" },
  { name: "Vedant Computers", domain: "vedantcomputers.com" },
  { name: "PrimeABGB", domain: "primeabgb.com" },
  { name: "Computech Store", domain: "computechstore.in" },
];

function normalizeProductUrl(value: string) {
  let cleaned = value.trim().replace(/\s+/g, "");
  if (!cleaned) return "";

  // Common mobile paste mistakes.
  cleaned = cleaned
    .replace(/^ttps:\/\//i, "https://")
    .replace(/^ttp:\/\//i, "http://")
    .replace(/^https?:\/([^/])/i, "https://$1");

  if (!/^https?:\/\//i.test(cleaned)) {
    cleaned = `https://${cleaned}`;
  }

  try {
    const url = new URL(cleaned);
    url.hash = "";

    // Tracking params are noise and can create duplicate URLs.
    [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
      "fbclid",
      "gclid",
    ].forEach((key) => url.searchParams.delete(key));

    return url.toString();
  } catch {
    return "";
  }
}

function detectSupportedStore(value: string) {
  const raw = value.trim().toLowerCase();

  // First, tolerate partially pasted/malformed URLs by checking the known domain text.
  const directMatch = SUPPORTED_STORES.find((store) =>
    raw.includes(store.domain.toLowerCase())
  );
  if (directMatch) return directMatch;

  try {
    const normalized = normalizeProductUrl(value);
    if (!normalized) return null;
    const hostname = new URL(normalized).hostname.toLowerCase().replace(/^www\./, "");
    return (
      SUPPORTED_STORES.find(
        (store) => hostname === store.domain || hostname.endsWith(`.${store.domain}`)
      ) || null
    );
  } catch {
    return null;
  }
}

function htmlDecode(value: string) {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function cleanDetectedTitle(value: string) {
  return htmlDecode(value)
    .replace(/\s+/g, " ")
    .replace(/\s*[|–—-]\s*(MDComputers|Vedant Computers|PrimeABGB|Computech Store).*$/i, "")
    .trim();
}

function inferBrandFromName(value: string) {
  const name = value.trim();
  const knownBrands = [
    "Western Digital",
    "WD Black",
    "Gigabyte",
    "Corsair",
    "Kingston",
    "Crucial",
    "Samsung",
    "TeamGroup",
    "Team Group",
    "Patriot",
    "G.Skill",
    "ADATA",
    "Adata",
    "Zotac",
    "Inno3D",
    "ASUS",
    "Asus",
    "MSI",
    "PNY",
    "Seagate",
  ];

  const match = knownBrands.find((item) =>
    name.toLowerCase().startsWith(item.toLowerCase())
  );

  if (!match) return "";
  if (/^wd black$/i.test(match)) return "Western Digital";
  if (/^team group$/i.test(match)) return "TeamGroup";
  if (/^adata$/i.test(match)) return "ADATA";
  if (/^asus$/i.test(match)) return "ASUS";
  return match;
}

function inferCategoryFromProduct(value: string): "GPU" | "RAM" | "SSD" | null {
  const text = value.toLowerCase();
  if (/rtx|gtx|radeon|graphics card|gpu/.test(text)) return "GPU";
  if (/ddr[345]|memory|ram|vengeance|trident|fury beast/.test(text)) return "RAM";
  if (/nvme|ssd|sn7|m\.2|solid state/.test(text)) return "SSD";
  return null;
}

function inferSkuFromText(text: string, url: string) {
  const candidates = [
    /(?:model|model no|part no|part number|sku)\s*[:#-]?\s*([A-Z0-9][A-Z0-9._-]{4,})/i,
    /\b([A-Z]{1,6}[A-Z0-9]*-[A-Z0-9][A-Z0-9-]{4,})\b/i,
    /\b([A-Z]{2,}[0-9][A-Z0-9-]{5,})\b/i,
  ];

  for (const regex of candidates) {
    const match = text.match(regex);
    if (match?.[1]) return match[1].toUpperCase();
  }

  try {
    const slug = new URL(url).pathname.split("/").filter(Boolean).pop() || "";
    const slugParts = slug.split("-");
    for (let start = 0; start < slugParts.length; start += 1) {
      const candidate = slugParts.slice(start).join("-").toUpperCase();
      if (
        candidate.length >= 7 &&
        /[A-Z]/.test(candidate) &&
        /[0-9]/.test(candidate) &&
        candidate.length <= 28
      ) {
        return candidate;
      }
    }
  } catch {}

  return "";
}

function detectPriceFromHtml(html: string, storeName: string) {
  const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const patterns = storeName === "MDComputers"
    ? [
        /Offer Price\s*₹\s*([\d,]+(?:\.\d{2})?)/i,
        /₹\s*([\d,]+(?:\.\d{2})?)\s*(?:Add to Cart|Buy Now)/i,
      ]
    : storeName === "Computech Store"
    ? [
        /₹\s*([\d,]+(?:\.\d{2})?)\s*Save Extra/i,
        /₹\s*([\d,]+(?:\.\d{2})?)/i,
      ]
    : [
        /(?:product-price-new|special|sale price)[^₹]{0,80}₹\s*([\d,]+(?:\.\d{2})?)/i,
        /₹\s*([\d,]+(?:\.\d{2})?)/i,
      ];

  for (const regex of patterns) {
    const match = text.match(regex);
    if (!match?.[1]) continue;
    const price = Number(match[1].replace(/,/g, ""));
    if (Number.isFinite(price) && price >= 500 && price <= 1000000) return price;
  }
  return null;
}

type Product = {
  id: number;
  category: "GPU" | "RAM" | "SSD";
  name: string;
  brand: string | null;
  model: string | null;
  product_role:
  | "tracked"
  | "market_pulse"
  | "dream_build";
};

type PriceHistory = {
  id: number;
  product_id: number;
  source_type: "online" | "local";
  source_name: string;
  source_id: number | null;
  price: number;
  captured_at: string;
  in_stock: boolean;

  match_confidence:
    | "exact_sku"
    | "model_match"
    | "generic"
    | null;
};

type StorePrice = {
  source: string;
  price: number;
};

type DisplayProduct = Product & {
  onlinePrice: number | null;
  localPrice: number | null;
  onlineSource: string | null;
  localSource: string | null;
  onlineStores: StorePrice[];
  localStores: StorePrice[];
  updatedAt: string | null;
  localMatchConfidence:
  | "exact_sku"
  | "model_match"
  | "generic"
  | null;
};

function formatPrice(price: number | null) {
  if (price === null) return "N/A";

  return `₹${price.toLocaleString("en-IN")}`;
}

function formatRelativeTime(value: string | null) {
  if (!value) return "No recent update";

  const diffMs = Date.now() - new Date(value).getTime();
  const minutes = Math.max(0, Math.floor(diffMs / 60000));

  if (minutes < 1) return "Updated just now";
  if (minutes < 60) return `Updated ${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Updated ${hours}h ago`;

  const days = Math.floor(hours / 24);
  return `Updated ${days}d ago`;
}

function isStale(value: string | null, hours = 24) {
  if (!value) return true;
  return Date.now() - new Date(value).getTime() > hours * 60 * 60 * 1000;
}

function getBestComparablePrice(product: DisplayProduct) {
  const candidates = [product.onlinePrice];

  if (product.localMatchConfidence !== "generic") {
    candidates.push(product.localPrice);
  }

  const valid = candidates.filter(
    (value): value is number => value !== null
  );

  return valid.length > 0 ? Math.min(...valid) : null;
}

function ProductCard({
  item,
  onPress,
}: {
  item: DisplayProduct;
  onPress?: () => void;
}) {
 const canCompare =
  item.onlinePrice !== null &&
  item.localPrice !== null &&
  item.localMatchConfidence !== "generic";

const difference =
  canCompare
    ? Math.abs(
        item.onlinePrice! - item.localPrice!
      )
    : null;

  const cheaper =
  canCompare
    ? item.onlinePrice! < item.localPrice!
      ? "Online"
      : item.localPrice! < item.onlinePrice!
      ? "Local"
      : "Same"
    : null;

  const stale = isStale(item.updatedAt);

  return (
    <Pressable
  style={styles.productCard}
  onPress={onPress}
>
      <View style={styles.productTopRow}>
        <Text style={styles.productType}>{item.category}</Text>
        <View style={styles.productBadgeRow}>
          {item.product_role === "dream_build" && (
            <Text style={styles.roleBadge}>DREAM BUILD</Text>
          )}
          <Text
            style={[
              styles.freshnessBadge,
              stale && styles.freshnessBadgeStale,
            ]}
          >
            {stale ? "STALE" : "FRESH"}
          </Text>
        </View>
      </View>
      <Text style={styles.productName}>{item.name}</Text>

      <View style={styles.priceRow}>
        <View style={styles.priceBlock}>
          <Text style={styles.priceLabel}>Online</Text>
          <Text style={styles.price}>
            {formatPrice(item.onlinePrice)}
          </Text>

          <Text style={styles.sourceText}>
            {item.onlineSource || "Unknown source"}
          </Text>
        </View>

        <View style={styles.priceBlock}>
          <Text style={styles.priceLabel}>Local</Text>
          <Text style={styles.price}>
            {formatPrice(item.localPrice)}
          </Text>

          <Text style={styles.sourceText}>
           {item.localSource
  ? `${item.localSource} • Nehru Place`
  : "Unknown source"}
          </Text>
          {item.localMatchConfidence === "model_match" && (
  <Text style={styles.matchBadge}>
    Model Match
  </Text>
)}

{item.localMatchConfidence === "generic" && (
  <Text style={styles.matchBadge}>
    Generic Match • Not directly comparable
  </Text>
)}
        </View>
      </View>

      {difference !== null && cheaper && (
        <View style={styles.comparisonBox}>
          <Text style={styles.comparisonText}>
            {cheaper === "Same"
              ? "Same price online and local"
              : `${cheaper} cheaper by ${formatPrice(difference)}`}
          </Text>
        </View>
      )}

        {(item.onlineStores?.length ?? 0) > 1 && (
        <View style={styles.storeList}>
         <Text style={styles.storeListTitle}>
      Online Stores
        </Text>

          {(item.onlineStores ?? []).map((store, index) => (
       <View
        key={`${store.source}-${index}`}
        style={styles.storeRow}
       >
        <Text style={styles.storeName}>
          {index === 0 ? "★ " : ""}
          {store.source}
        </Text>

        <Text style={styles.storePrice}>
          {formatPrice(store.price)}
        </Text>

      </View>
       ))}
       </View>
        )}
        <View style={styles.statusBadge}>
        <Text style={styles.statusText}>Live Data</Text>
      </View>

      <Text style={styles.updatedText}>
        {formatRelativeTime(item.updatedAt)}
      </Text>
      </Pressable>
  );
}

function useProducts() {
  const [products, setProducts] = useState<DisplayProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function loadProducts(silent = false) {
    try {
      if (!silent) setLoading(true);
      setError("");

      const { data: productData, error: productError } =
        await supabase
          .from("products")
          .select("*")
          .order("id", { ascending: true });

      if (productError) {
        throw productError;
      }

      const { data: sourceData, error: sourceError } =
        await supabase
          .from("sources")
          .select("*");

      if (sourceError) {
        throw sourceError;
      }

      const { data: priceData, error: priceError } =
        await supabase
          .from("price_history")
          .select("*")
          .order("captured_at", { ascending: false });

      if (priceError) {
        throw priceError;
      }

      const productsList = (productData || []) as Product[];
      const pricesList = (priceData || []) as PriceHistory[];
      const sourcesList = sourceData || [];

      const getSourceName = (sourceId: number | null) => {
        if (!sourceId) return null;

        const source = sourcesList.find(
          (item: any) => item.id === sourceId
        );

        return source ? source.name : null;
      };

const finalProducts: DisplayProduct[] = productsList.map((product) => {
  const productPrices = pricesList.filter(
    (price) => price.product_id === product.id
  );

  // pricesList already newest -> oldest hai.
  // Har source ki sirf latest price rakho.
  const latestBySource = new Map<number | string, PriceHistory>();

  for (const price of productPrices) {
    const key =
      price.source_id ??
      `${price.source_type}-${price.source_name}`;

    if (!latestBySource.has(key)) {
      latestBySource.set(key, price);
    }
  }

  const latestPrices = Array.from(latestBySource.values());

 const onlinePrices = latestPrices
  .filter(
    (price) =>
      price.source_type === "online" &&
      price.in_stock === true
  )
  .sort(
    (a, b) =>
      Number(a.price) - Number(b.price)
  );

 const localPrices = latestPrices
  .filter(
    (price) =>
      price.source_type === "local" &&
      price.in_stock === true
  )
  .sort(
    (a, b) =>
      Number(a.price) - Number(b.price)
  );

  const bestOnline = onlinePrices[0] || null;
const comparableLocalPrices = localPrices.filter(
  (price) =>
    price.match_confidence === "exact_sku" ||
    price.match_confidence === "model_match"
);

const bestLocal =
  comparableLocalPrices[0] ||
  localPrices[0] ||
  null;
  
  const onlineStores: StorePrice[] = onlinePrices.map((price) => ({
  source:
    getSourceName(price.source_id) ||
    price.source_name ||
    "Unknown source",
  price: Number(price.price),
}));

const localStores: StorePrice[] = localPrices.map((price) => ({
  source:
    getSourceName(price.source_id) ||
    price.source_name ||
    "Unknown source",
  price: Number(price.price),
}));

return {
  ...product,

  onlinePrice: bestOnline
    ? Number(bestOnline.price)
    : null,

  localPrice: bestLocal
    ? Number(bestLocal.price)
    : null,

  onlineSource: bestOnline
    ? getSourceName(bestOnline.source_id) ||
      bestOnline.source_name
    : null,

  localSource: bestLocal
    ? getSourceName(bestLocal.source_id) ||
      bestLocal.source_name
    : null,
   
  updatedAt: bestOnline ? bestOnline.captured_at : null,

  localMatchConfidence: bestLocal
  ? bestLocal.match_confidence
  : null,  

  onlineStores,
  localStores,
};
});
      setProducts(finalProducts);
    } catch (err: any) {
      setError(err?.message || "Failed to load market data");
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    loadProducts();
  }, []);

  return {
    products,
    loading,
    error,
    refresh: () => loadProducts(true),
  };
}

function LoadingScreen() {
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#35D07F" />
        <Text style={styles.loadingText}>Loading market data...</Text>
      </View>
    </SafeAreaView>
  );
}

function ErrorScreen({ message }: { message: string }) {
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.center}>
        <Text style={styles.errorTitle}>Could not load data</Text>
        <Text style={styles.subtitle}>{message}</Text>
      </View>
    </SafeAreaView>
  );
}

function HomeScreen({ navigation }: any) {
  const { products, loading, error, refresh } = useProducts();

  const [marketPulseHistory, setMarketPulseHistory] = useState<any[]>([]);
  const [homeWatchlist, setHomeWatchlist] = useState<any[]>([]);
  const [showTargetModal, setShowTargetModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | "dream_build" | "tracked">("all");
  const [sortMode, setSortMode] = useState<"smart" | "price" | "savings">("smart");
  const [refreshing, setRefreshing] = useState(false);
  const lastNotifiedHitSignature = useRef("");

  const marketPulse = products.find(
    (item) => item.product_role === "market_pulse"
  );

  async function loadMarketPulseHistory() {
    if (!marketPulse) {
      setMarketPulseHistory([]);
      return;
    }

    const { data, error } = await supabase
      .from("price_history")
      .select("*")
      .eq("product_id", marketPulse.id)
      .eq("source_type", "online")
      .eq("in_stock", true)
      .order("captured_at", { ascending: true });

    if (!error) setMarketPulseHistory(data || []);
  }

  async function loadHomeWatchlist() {
    const { data, error } = await supabase
      .from("watchlist")
      .select("*");

    if (!error) setHomeWatchlist(data || []);
  }

  useEffect(() => {
    void loadMarketPulseHistory();
  }, [marketPulse?.id]);

  useFocusEffect(
    useCallback(() => {
      void loadHomeWatchlist();
    }, [])
  );

  const dailyPulseMap = new Map<string, number>();
  for (const item of marketPulseHistory) {
    if (item.in_stock !== true) continue;
    const day = new Date(item.captured_at).toISOString().slice(0, 10);
    const price = Number(item.price);
    const existing = dailyPulseMap.get(day);
    if (existing === undefined || price < existing) {
      dailyPulseMap.set(day, price);
    }
  }

  const dailyPulseHistory = Array.from(dailyPulseMap.entries())
    .map(([date, price]) => ({ date, price }))
    .sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
    );

  const getMarketChange = (days: number) => {
    if (!marketPulse || marketPulse.onlinePrice === null) return null;

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    const history = dailyPulseHistory.filter(
      (item) => new Date(item.date) >= cutoff
    );

    if (history.length < 2) return null;

    const firstPrice = history[0].price;
    return firstPrice
      ? ((marketPulse.onlinePrice - firstPrice) / firstPrice) * 100
      : null;
  };

  const market7D = getMarketChange(7);
  const market30D = getMarketChange(30);

  const targetHits = homeWatchlist
    .map((watch) => {
      const product = products.find((item) => item.id === watch.product_id);
      if (!product) return null;

      const currentPrice = product.onlinePrice;
      const targetPrice =
        watch.target_price !== null ? Number(watch.target_price) : null;

      if (
        currentPrice === null ||
        targetPrice === null ||
        currentPrice > targetPrice
      ) {
        return null;
      }

      return {
        product,
        currentPrice,
        targetPrice,
        saving: targetPrice - currentPrice,
      };
    })
    .filter(
      (item): item is NonNullable<typeof item> => item !== null
    );

  const targetHitSignature = targetHits
    .map(
      (item) => `${item.product.id}:${item.currentPrice}:${item.targetPrice}`
    )
    .join("|");

  useEffect(() => {
    if (targetHits.length === 0 || !targetHitSignature) return;

    setShowTargetModal(true);

    if (lastNotifiedHitSignature.current === targetHitSignature) return;
    lastNotifiedHitSignature.current = targetHitSignature;

    const firstHit = targetHits[0];
    void sendTargetHitNotification(
      firstHit.product.name,
      firstHit.currentPrice,
      firstHit.targetPrice
    );
  }, [targetHitSignature]);

  const trackedProducts = products.filter(
    (item) => item.product_role !== "market_pulse"
  );

  const dreamProducts = trackedProducts.filter(
    (item) => item.product_role === "dream_build"
  );
  const dreamTotal = dreamProducts.reduce(
    (sum, item) => sum + (getBestComparablePrice(item) || 0),
    0
  );

  const deals = trackedProducts
    .map((item) => {
      if (
        item.onlinePrice === null ||
        item.localPrice === null ||
        item.localMatchConfidence === "generic"
      ) {
        return null;
      }

      const saving = Math.abs(item.onlinePrice - item.localPrice);
      const base = Math.max(item.onlinePrice, item.localPrice);
      const percent = base > 0 ? (saving / base) * 100 : 0;
      const winner = item.onlinePrice < item.localPrice ? "Online" : "Local";

      return { item, saving, percent, winner };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .sort((a, b) => b.saving - a.saving);

  const staleCount = trackedProducts.filter((item) => isStale(item.updatedAt)).length;

  let visibleProducts = trackedProducts.filter((item) => {
    const q = searchQuery.trim().toLowerCase();
    const matchesSearch =
      !q ||
      item.name.toLowerCase().includes(q) ||
      (item.brand || "").toLowerCase().includes(q) ||
      (item.model || "").toLowerCase().includes(q);

    const matchesRole =
      roleFilter === "all" || item.product_role === roleFilter;

    return matchesSearch && matchesRole;
  });

  visibleProducts = [...visibleProducts].sort((a, b) => {
    if (sortMode === "price") {
      return (getBestComparablePrice(a) ?? Number.MAX_SAFE_INTEGER) -
        (getBestComparablePrice(b) ?? Number.MAX_SAFE_INTEGER);
    }

    if (sortMode === "savings") {
      const getSaving = (item: DisplayProduct) =>
        item.onlinePrice !== null &&
        item.localPrice !== null &&
        item.localMatchConfidence !== "generic"
          ? Math.abs(item.onlinePrice - item.localPrice)
          : 0;
      return getSaving(b) - getSaving(a);
    }

    if (a.product_role !== b.product_role) {
      return a.product_role === "dream_build" ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });

  async function onRefresh() {
    setRefreshing(true);
    await Promise.all([
      refresh(),
      loadHomeWatchlist(),
      loadMarketPulseHistory(),
    ]);
    setRefreshing(false);
  }

  if (loading) return <LoadingScreen />;
  if (error) return <ErrorScreen message={error} />;

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" />

      <ScrollView
        contentContainerStyle={styles.container}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#35D07F"
          />
        }
      >
        <Text style={styles.title}>PC Market Tracker</Text>
        <Text style={styles.subtitle}>India Online + Local Market Prices</Text>

        <Pressable
          style={styles.addProductQuickButton}
          onPress={() => navigation.navigate("AddProduct")}
        >
          <View style={styles.addProductQuickIcon}>
            <Ionicons name="add" size={20} color="#07120B" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.addProductQuickTitle}>Add product by link</Text>
            <Text style={styles.addProductQuickText}>Paste a store URL and start tracking the exact SKU</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color="#7E899A" />
        </Pressable>

        {targetHits.length > 0 && (
          <Pressable
            style={styles.targetAlertStrip}
            onPress={() => navigation.navigate("Watchlist")}
          >
            <Text style={styles.targetAlertStripText}>
              🎯 {targetHits.length} price target
              {targetHits.length > 1 ? "s" : ""} hit
            </Text>
            <Text style={styles.targetAlertStripAction}>View</Text>
          </Pressable>
        )}

        <View style={styles.dashboardGrid}>
          <View style={styles.dashboardCard}>
            <Text style={styles.dashboardLabel}>Dream Build</Text>
            <Text style={styles.dashboardValue}>{dreamProducts.length}</Text>
            <Text style={styles.dashboardMeta}>parts selected</Text>
          </View>
          <View style={styles.dashboardCard}>
            <Text style={styles.dashboardLabel}>Current Build</Text>
            <Text style={styles.dashboardValueSmall}>
              {formatPrice(dreamTotal || null)}
            </Text>
            <Text style={styles.dashboardMeta}>best comparable prices</Text>
          </View>
          <View style={styles.dashboardCard}>
            <Text style={styles.dashboardLabel}>Price Alerts</Text>
            <Text style={styles.dashboardValue}>{homeWatchlist.length}</Text>
            <Text style={styles.dashboardMeta}>{targetHits.length} hit now</Text>
          </View>
          <View style={styles.dashboardCard}>
            <Text style={styles.dashboardLabel}>Data Health</Text>
            <Text style={styles.dashboardValue}>{staleCount}</Text>
            <Text style={styles.dashboardMeta}>stale products</Text>
          </View>
        </View>

        {marketPulse && (
          <Pressable
            style={styles.marketPulseCard}
            onPress={() =>
              navigation.navigate("ProductDetail", { product: marketPulse })
            }
          >
            <Text style={styles.marketPulseLabel}>MARKET PULSE • DDR5 RAM</Text>
            <Text style={styles.marketPulseName}>{marketPulse.name}</Text>
            <Text style={styles.marketPulsePrice}>
              {formatPrice(marketPulse.onlinePrice)}
            </Text>
            <Text style={styles.marketPulseSource}>
              Best today • {marketPulse.onlineSource}
            </Text>

            {(marketPulse.onlineStores ?? []).map((store, index) => (
              <View
                key={`${store.source}-${index}`}
                style={styles.marketPulseStoreRow}
              >
                <Text style={styles.marketPulseStoreName}>
                  {index === 0 ? "★ " : ""}
                  {store.source}
                </Text>
                <Text style={styles.marketPulseStorePrice}>
                  {formatPrice(store.price)}
                </Text>
              </View>
            ))}

            {dailyPulseHistory.length > 1 && (
              <LineChart
                data={{
                  labels: dailyPulseHistory.slice(-7).map((item) => {
                    const d = new Date(item.date);
                    return `${d.getDate()}/${d.getMonth() + 1}`;
                  }),
                  datasets: [
                    { data: dailyPulseHistory.slice(-7).map((item) => item.price) },
                  ],
                }}
                width={Dimensions.get("window").width - 76}
                height={120}
                withDots={false}
                withInnerLines={false}
                withOuterLines={false}
                yAxisLabel="₹"
                chartConfig={{
                  backgroundColor: "#151B26",
                  backgroundGradientFrom: "#151B26",
                  backgroundGradientTo: "#151B26",
                  decimalPlaces: 0,
                  color: (opacity = 1) => `rgba(53, 208, 127, ${opacity})`,
                  labelColor: (opacity = 1) => `rgba(126, 137, 154, ${opacity})`,
                }}
                style={styles.miniChart}
              />
            )}

            <View style={styles.marketPulseTrendRow}>
              <Text style={styles.marketPulseHistory}>
                7D {market7D === null ? "Building history" : `${market7D <= 0 ? "↓" : "↑"} ${Math.abs(market7D).toFixed(2)}%`}
              </Text>
              <Text style={styles.marketPulseHistory}>
                30D {market30D === null ? "Building history" : `${market30D <= 0 ? "↓" : "↑"} ${Math.abs(market30D).toFixed(2)}%`}
              </Text>
            </View>
          </Pressable>
        )}

        <View style={styles.marketCard}>
          <Text style={styles.sectionTitle}>Market Today</Text>
          <View style={styles.marketRow}>
            {(["GPU", "RAM", "SSD"] as const).map((category) => (
              <View key={category}>
                <Text style={styles.marketLabel}>{category}</Text>
                <Text style={styles.marketValue}>
                  {products.filter((item) => item.category === category).length} tracked
                </Text>
              </View>
            ))}
          </View>
        </View>

        {deals.length > 0 && (
          <View style={styles.dealsCard}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>Best Market Deals</Text>
              <Text style={styles.sectionHint}>Online vs local</Text>
            </View>
            {deals.slice(0, 3).map((deal, index) => (
              <Pressable
                key={deal.item.id}
                style={styles.dealRow}
                onPress={() =>
                  navigation.navigate("ProductDetail", { product: deal.item })
                }
              >
                <View style={styles.dealRank}><Text style={styles.dealRankText}>{index + 1}</Text></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.dealName}>{deal.item.name}</Text>
                  <Text style={styles.dealMeta}>
                    {deal.winner} cheaper • {deal.percent.toFixed(1)}%
                  </Text>
                </View>
                <Text style={styles.dealSaving}>{formatPrice(deal.saving)}</Text>
              </Pressable>
            ))}
          </View>
        )}

        <Text style={styles.sectionTitle}>Tracked Hardware</Text>

        <View style={styles.searchBox}>
          <Ionicons name="search-outline" size={18} color="#7E899A" />
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search name, brand or model"
            placeholderTextColor="#596579"
            style={styles.searchInput}
          />
          {searchQuery.length > 0 && (
            <Pressable onPress={() => setSearchQuery("")}>
              <Ionicons name="close-circle" size={18} color="#7E899A" />
            </Pressable>
          )}
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroller}>
          {([
            ["all", "All"],
            ["dream_build", "Dream Build"],
            ["tracked", "Tracked"],
          ] as const).map(([value, label]) => (
            <Pressable
              key={value}
              onPress={() => setRoleFilter(value)}
              style={[styles.filterChip, roleFilter === value && styles.filterChipActive]}
            >
              <Text style={[styles.filterChipText, roleFilter === value && styles.filterChipTextActive]}>{label}</Text>
            </Pressable>
          ))}
        </ScrollView>

        <View style={styles.sortRow}>
          <Text style={styles.sortLabel}>Sort</Text>
          {([
            ["smart", "Smart"],
            ["price", "Price"],
            ["savings", "Savings"],
          ] as const).map(([value, label]) => (
            <Pressable
              key={value}
              onPress={() => setSortMode(value)}
              style={[styles.sortChip, sortMode === value && styles.sortChipActive]}
            >
              <Text style={[styles.sortChipText, sortMode === value && styles.sortChipTextActive]}>{label}</Text>
            </Pressable>
          ))}
        </View>

        {visibleProducts.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="search-outline" size={28} color="#596579" />
            <Text style={styles.emptyTitle}>No matching hardware</Text>
            <Text style={styles.emptyText}>Try another search or filter.</Text>
          </View>
        ) : (
          visibleProducts.map((item) => (
            <ProductCard
              key={item.id}
              item={item}
              onPress={() =>
                navigation.navigate("ProductDetail", { product: item })
              }
            />
          ))
        )}
      </ScrollView>

      <Modal
        visible={showTargetModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowTargetModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.targetModal}>
            <Text style={styles.targetModalEmoji}>🎯</Text>
            <Text style={styles.targetModalTitle}>Price Target Hit</Text>

            {targetHits[0] && (
              <>
                <Text style={styles.targetModalProduct}>{targetHits[0].product.name}</Text>
                <View style={styles.targetModalPriceRow}>
                  <View>
                    <Text style={styles.priceLabel}>Target</Text>
                    <Text style={styles.targetModalPrice}>{formatPrice(targetHits[0].targetPrice)}</Text>
                  </View>
                  <View>
                    <Text style={styles.priceLabel}>Current</Text>
                    <Text style={styles.targetModalPrice}>{formatPrice(targetHits[0].currentPrice)}</Text>
                  </View>
                </View>
                <Text style={styles.targetModalSaving}>You save {formatPrice(targetHits[0].saving)}</Text>
                <Pressable
                  style={styles.modalPrimaryButton}
                  onPress={() => {
                    setShowTargetModal(false);
                    navigation.navigate("ProductDetail", { product: targetHits[0].product });
                  }}
                >
                  <Text style={styles.modalPrimaryButtonText}>View Product</Text>
                </Pressable>
              </>
            )}

            <Pressable style={styles.modalDismissButton} onPress={() => setShowTargetModal(false)}>
              <Text style={styles.modalDismissText}>Dismiss</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function CategoryScreen({
  type,
  navigation,
}: {
  type: "GPU" | "RAM" | "SSD";
  navigation: any;
}) {
  const { products, loading, error, refresh } = useProducts();
  const [searchQuery, setSearchQuery] = useState("");
  const [sortMode, setSortMode] = useState<"price" | "name" | "stores">("price");
  const [refreshing, setRefreshing] = useState(false);

  const categoryProducts = products.filter((item) => item.category === type);
  const prices = categoryProducts
    .map((item) => getBestComparablePrice(item))
    .filter((value): value is number => value !== null);

  const lowest = prices.length ? Math.min(...prices) : null;
  const average = prices.length
    ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length)
    : null;
  const multiStore = categoryProducts.filter(
    (item) => item.onlineStores.length + item.localStores.length > 1
  ).length;

  let visible = categoryProducts.filter((item) => {
    const q = searchQuery.trim().toLowerCase();
    return (
      !q ||
      item.name.toLowerCase().includes(q) ||
      (item.brand || "").toLowerCase().includes(q) ||
      (item.model || "").toLowerCase().includes(q)
    );
  });

  visible = [...visible].sort((a, b) => {
    if (sortMode === "name") return a.name.localeCompare(b.name);
    if (sortMode === "stores") {
      return (
        b.onlineStores.length + b.localStores.length -
        (a.onlineStores.length + a.localStores.length)
      );
    }
    return (
      (getBestComparablePrice(a) ?? Number.MAX_SAFE_INTEGER) -
      (getBestComparablePrice(b) ?? Number.MAX_SAFE_INTEGER)
    );
  });

  async function onRefresh() {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }

  if (loading) return <LoadingScreen />;
  if (error) return <ErrorScreen message={error} />;

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        contentContainerStyle={styles.container}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#35D07F" />
        }
      >
        <Text style={styles.title}>{type}</Text>
        <Text style={styles.subtitle}>Live tracked {type} market prices</Text>

        <View style={styles.categorySummaryCard}>
          <View style={styles.categoryStat}>
            <Text style={styles.priceLabel}>Tracked</Text>
            <Text style={styles.categoryStatValue}>{categoryProducts.length}</Text>
          </View>
          <View style={styles.categoryStat}>
            <Text style={styles.priceLabel}>Lowest</Text>
            <Text style={styles.categoryStatValue}>{formatPrice(lowest)}</Text>
          </View>
          <View style={styles.categoryStat}>
            <Text style={styles.priceLabel}>Average</Text>
            <Text style={styles.categoryStatValue}>{formatPrice(average)}</Text>
          </View>
          <View style={styles.categoryStat}>
            <Text style={styles.priceLabel}>Multi-store</Text>
            <Text style={styles.categoryStatValue}>{multiStore}</Text>
          </View>
        </View>

        <View style={styles.searchBox}>
          <Ionicons name="search-outline" size={18} color="#7E899A" />
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder={`Search ${type}`}
            placeholderTextColor="#596579"
            style={styles.searchInput}
          />
        </View>

        <View style={styles.sortRow}>
          <Text style={styles.sortLabel}>Sort</Text>
          {([
            ["price", "Price"],
            ["name", "Name"],
            ["stores", "Stores"],
          ] as const).map(([value, label]) => (
            <Pressable
              key={value}
              onPress={() => setSortMode(value)}
              style={[styles.sortChip, sortMode === value && styles.sortChipActive]}
            >
              <Text style={[styles.sortChipText, sortMode === value && styles.sortChipTextActive]}>{label}</Text>
            </Pressable>
          ))}
        </View>

        {visible.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No {type} found</Text>
            <Text style={styles.emptyText}>Try changing your search.</Text>
          </View>
        ) : (
          visible.map((item) => (
            <ProductCard
              key={item.id}
              item={item}
              onPress={() => navigation.navigate("ProductDetail", { product: item })}
            />
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function ProductDetailScreen({ route }: any) {
  const { product } = route.params as { product: DisplayProduct };

  const [history, setHistory] = useState<any[]>([]);
  const [range, setRange] = useState<"7D" | "30D" | "ALL">("7D");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [targetPrice, setTargetPrice] = useState("");
  const [watchSaving, setWatchSaving] = useState(false);
  const [watchMessage, setWatchMessage] = useState("");
  const [existingWatchId, setExistingWatchId] = useState<number | null>(null);

  async function loadHistory(silent = false) {
    if (!silent) setLoading(true);

    const { data, error } = await supabase
      .from("price_history")
      .select("*")
      .eq("product_id", product.id)
      .eq("source_type", "online")
      .eq("in_stock", true)
      .order("captured_at", { ascending: true });

    if (!error) setHistory(data || []);
    if (!silent) setLoading(false);
  }

  async function loadExistingTarget() {
    const { data, error } = await supabase
      .from("watchlist")
      .select("id, target_price")
      .eq("product_id", product.id)
      .maybeSingle();

    if (error) {
      console.log("Load target error:", error);
      return;
    }

    if (data) {
      setExistingWatchId(data.id);
      setTargetPrice(data.target_price !== null ? String(data.target_price) : "");
    } else {
      setExistingWatchId(null);
      setTargetPrice("");
    }
  }

  useEffect(() => {
    void loadHistory();
    void loadExistingTarget();
  }, [product.id]);

  const now = new Date();
  const filteredHistory = history.filter((item) => {
    const date = new Date(item.captured_at);
    if (range === "7D") {
      const cutoff = new Date(now);
      cutoff.setDate(now.getDate() - 7);
      return date >= cutoff;
    }
    if (range === "30D") {
      const cutoff = new Date(now);
      cutoff.setDate(now.getDate() - 30);
      return date >= cutoff;
    }
    return true;
  });

  const groupedByDay = new Map<string, { date: string; price: number }>();
  for (const item of filteredHistory) {
    const dayKey = new Date(item.captured_at).toISOString().slice(0, 10);
    const itemPrice = Number(item.price);
    const existing = groupedByDay.get(dayKey);
    if (!existing || itemPrice < existing.price) {
      groupedByDay.set(dayKey, { date: dayKey, price: itemPrice });
    }
  }

  const bestHistory = Array.from(groupedByDay.values()).sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );
  const chartPrices = bestHistory.map((item) => item.price);
  const lowest = chartPrices.length ? Math.min(...chartPrices) : null;
  const highest = chartPrices.length ? Math.max(...chartPrices) : null;
  const current = product.onlinePrice;
  const firstPrice = chartPrices.length ? chartPrices[0] : null;
  const hasEnoughHistory = bestHistory.length >= 2;
  const changeAmount =
    hasEnoughHistory && firstPrice !== null && current !== null
      ? current - firstPrice
      : null;
  const changePercent =
    hasEnoughHistory && firstPrice !== null && current !== null && firstPrice !== 0
      ? ((current - firstPrice) / firstPrice) * 100
      : null;
  const average = chartPrices.length
    ? chartPrices.reduce((sum, price) => sum + price, 0) / chartPrices.length
    : null;

  const onlinePrices = product.onlineStores.map((store) => store.price);
  const storeLow = onlinePrices.length ? Math.min(...onlinePrices) : null;
  const storeHigh = onlinePrices.length ? Math.max(...onlinePrices) : null;
  const storeSpread =
    storeLow !== null && storeHigh !== null ? storeHigh - storeLow : null;
  const storeSpreadPercent =
    storeLow && storeSpread !== null ? (storeSpread / storeLow) * 100 : null;

  const localSaving =
    product.onlinePrice !== null &&
    product.localPrice !== null &&
    product.localMatchConfidence !== "generic"
      ? product.onlinePrice - product.localPrice
      : null;

  const parsedTarget = Number(targetPrice.replace(/,/g, ""));
  const targetDistance =
    Number.isFinite(parsedTarget) && parsedTarget > 0 && current !== null
      ? current - parsedTarget
      : null;

  async function onRefresh() {
    setRefreshing(true);
    await Promise.all([loadHistory(true), loadExistingTarget()]);
    setRefreshing(false);
  }

  async function sharePrice() {
    const lines = [
      product.name,
      `Best online: ${formatPrice(product.onlinePrice)}${product.onlineSource ? ` at ${product.onlineSource}` : ""}`,
    ];
    if (product.localPrice !== null && product.localMatchConfidence !== "generic") {
      lines.push(`Best local: ${formatPrice(product.localPrice)}${product.localSource ? ` at ${product.localSource}` : ""}`);
    }
    lines.push("Tracked with PC Market Tracker");
    await Share.share({ message: lines.join("\n") });
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        contentContainerStyle={styles.container}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#35D07F" />
        }
      >
        <View style={styles.detailHeaderRow}>
          <Text style={styles.productType}>{product.category}</Text>
          <Pressable style={styles.iconButton} onPress={sharePrice}>
            <Ionicons name="share-social-outline" size={20} color="#35D07F" />
          </Pressable>
        </View>

        <Text style={styles.title}>{product.name}</Text>
        <Text style={styles.subtitle}>Best current online price</Text>

        <View style={styles.productCard}>
          <Text style={styles.priceLabel}>Best Price</Text>
          <Text style={styles.detailPrice}>{formatPrice(product.onlinePrice)}</Text>
          <Text style={styles.sourceText}>{product.onlineSource}</Text>
          <Text style={styles.updatedText}>{formatRelativeTime(product.updatedAt)}</Text>
        </View>

        <View style={styles.intelligenceCard}>
          <Text style={styles.sectionTitle}>Price Intelligence</Text>
          <View style={styles.intelligenceGrid}>
            <View style={styles.intelligenceItem}>
              <Text style={styles.priceLabel}>Store spread</Text>
              <Text style={styles.intelligenceValue}>{formatPrice(storeSpread)}</Text>
              <Text style={styles.intelligenceMeta}>
                {storeSpreadPercent !== null ? `${storeSpreadPercent.toFixed(1)}% between stores` : "Need 2 stores"}
              </Text>
            </View>
            <View style={styles.intelligenceItem}>
              <Text style={styles.priceLabel}>Local advantage</Text>
              <Text style={[styles.intelligenceValue, localSaving !== null && localSaving > 0 && styles.priceDown]}>
                {localSaving === null ? "N/A" : localSaving > 0 ? formatPrice(localSaving) : "Online wins"}
              </Text>
              <Text style={styles.intelligenceMeta}>comparable matches only</Text>
            </View>
            <View style={styles.intelligenceItem}>
              <Text style={styles.priceLabel}>Target gap</Text>
              <Text style={styles.intelligenceValue}>
                {targetDistance === null ? "No target" : targetDistance <= 0 ? "Hit ✅" : formatPrice(targetDistance)}
              </Text>
              <Text style={styles.intelligenceMeta}>{targetDistance !== null && targetDistance > 0 ? "above target" : "watchlist status"}</Text>
            </View>
            <View style={styles.intelligenceItem}>
              <Text style={styles.priceLabel}>Data health</Text>
              <Text style={[styles.intelligenceValue, isStale(product.updatedAt) && styles.priceUp]}>
                {isStale(product.updatedAt) ? "STALE" : "FRESH"}
              </Text>
              <Text style={styles.intelligenceMeta}>{formatRelativeTime(product.updatedAt)}</Text>
            </View>
          </View>
        </View>

        <View style={styles.rangeRow}>
          {(["7D", "30D", "ALL"] as const).map((item) => (
            <Pressable
              key={item}
              onPress={() => setRange(item)}
              style={[styles.rangeButton, range === item && styles.rangeButtonActive]}
            >
              <Text style={[styles.rangeText, range === item && styles.rangeTextActive]}>{item}</Text>
            </Pressable>
          ))}
        </View>

        {loading ? (
          <ActivityIndicator size="large" color="#35D07F" />
        ) : chartPrices.length > 1 ? (
          <LineChart
            data={{
              labels: bestHistory.map((item) => {
                const date = new Date(item.date);
                return `${date.getDate()}/${date.getMonth() + 1}`;
              }),
              datasets: [{ data: chartPrices }],
            }}
            width={Dimensions.get("window").width - 40}
            height={240}
            yAxisLabel="₹"
            chartConfig={{
              backgroundColor: "#151B26",
              backgroundGradientFrom: "#151B26",
              backgroundGradientTo: "#151B26",
              decimalPlaces: 0,
              color: (opacity = 1) => `rgba(53, 208, 127, ${opacity})`,
              labelColor: (opacity = 1) => `rgba(170, 178, 192, ${opacity})`,
              propsForDots: { r: "4" },
            }}
            bezier
            style={styles.chart}
          />
        ) : (
          <Text style={styles.emptyText}>Not enough price history yet.</Text>
        )}

        {changePercent !== null && (
          <View style={styles.changeCard}>
            <Text style={styles.priceLabel}>{range} Price Change</Text>
            <Text style={[styles.changeValue, changePercent <= 0 ? styles.priceDown : styles.priceUp]}>
              {changePercent <= 0 ? "↓ " : "↑ "}{Math.abs(changePercent).toFixed(2)}%
            </Text>
            {changeAmount !== null && (
              <Text style={styles.changeAmount}>
                {changeAmount <= 0 ? "-" : "+"}{formatPrice(Math.abs(changeAmount))}
              </Text>
            )}
          </View>
        )}

        <View style={styles.statsRow}>
          {[
            ["Lowest", lowest],
            ["Current", current],
            ["Average", average !== null ? Math.round(average) : null],
            ["Highest", highest],
          ].map(([label, value]) => (
            <View style={styles.statItem} key={String(label)}>
              <Text style={styles.priceLabel}>{label}</Text>
              <Text style={styles.statsValue}>{formatPrice(value as number | null)}</Text>
            </View>
          ))}
        </View>

        <Text style={styles.sectionTitle}>Online Stores</Text>
        {(product.onlineStores || []).map((store: StorePrice, index: number) => (
          <View key={`${store.source}-${index}`} style={[styles.storeRow, index === 0 && styles.bestStoreRow]}>
            <View>
              <Text style={styles.storeName}>{index === 0 ? "★ " : ""}{store.source}</Text>
              {index === 0 && <Text style={styles.bestStoreLabel}>BEST CURRENT PRICE</Text>}
            </View>
            <Text style={styles.storePrice}>{formatPrice(store.price)}</Text>
          </View>
        ))}

        {(product.localStores || []).length > 0 && (
          <>
            <Text style={styles.subSectionTitle}>Local Stores</Text>
            {(product.localStores || []).map((store: StorePrice, index: number) => (
              <View key={`local-${store.source}-${index}`} style={styles.storeRow}>
                <Text style={styles.storeName}>{index === 0 ? "★ " : ""}{store.source}</Text>
                <Text style={styles.storePrice}>{formatPrice(store.price)}</Text>
              </View>
            ))}
          </>
        )}

        <View style={styles.watchSetupCard}>
          <Text style={styles.sectionTitle}>Price Alert</Text>

          {existingWatchId !== null && targetPrice !== "" && (
            <View style={styles.currentTargetBox}>
              <Text style={styles.currentTargetLabel}>Current target</Text>
              <Text style={styles.currentTargetValue}>
                {formatPrice(Number(targetPrice.replace(/,/g, "")))}
              </Text>
            </View>
          )}

          <Text style={styles.priceLabel}>
            {existingWatchId !== null ? "Update your target price" : "Set your target price"}
          </Text>

          <TextInput
            value={targetPrice}
            onChangeText={setTargetPrice}
            placeholder="Example: 28000"
            placeholderTextColor="#6E7A90"
            keyboardType="numeric"
            style={styles.targetInput}
          />

          <Pressable
            style={[styles.watchButton, watchSaving && styles.buttonDisabled]}
            disabled={watchSaving}
            onPress={async () => {
              const value = Number(targetPrice.replace(/,/g, ""));
              if (!Number.isFinite(value) || value <= 0) {
                setWatchMessage("Enter a valid target price");
                return;
              }

              setWatchSaving(true);
              setWatchMessage("");

              try {
                if (existingWatchId !== null) {
                  const { error } = await supabase
                    .from("watchlist")
                    .update({ target_price: value })
                    .eq("id", existingWatchId);
                  if (error) throw error;
                  setWatchMessage(`Target updated to ${formatPrice(value)}`);
                } else {
                  const { data, error } = await supabase
                    .from("watchlist")
                    .insert({ product_id: product.id, target_price: value })
                    .select("id")
                    .single();
                  if (error) throw error;
                  setExistingWatchId(data.id);
                  setWatchMessage(`Target set at ${formatPrice(value)}`);
                }
                await ensureNotificationPermission();
              } catch (err: any) {
                setWatchMessage(err?.message || "Could not save target price");
              } finally {
                setWatchSaving(false);
              }
            }}
          >
            <Text style={styles.watchButtonText}>
              {watchSaving ? "Saving..." : existingWatchId !== null ? "Update Target Price" : "Set Target Price"}
            </Text>
          </Pressable>

          {existingWatchId !== null && (
            <Pressable
              style={styles.removeAlertButton}
              disabled={watchSaving}
              onPress={async () => {
                setWatchSaving(true);
                setWatchMessage("");
                const { error } = await supabase
                  .from("watchlist")
                  .delete()
                  .eq("id", existingWatchId);
                if (error) {
                  setWatchMessage(error.message);
                } else {
                  setExistingWatchId(null);
                  setTargetPrice("");
                  setWatchMessage("Price alert removed");
                }
                setWatchSaving(false);
              }}
            >
              <Text style={styles.removeAlertButtonText}>Remove Price Alert</Text>
            </Pressable>
          )}

          {watchMessage !== "" && <Text style={styles.watchMessage}>{watchMessage}</Text>}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function WatchlistScreen({ navigation }: any) {
  const { products, loading, error, refresh } = useProducts();
  const [watchlist, setWatchlist] = useState<any[]>([]);
  const [watchLoading, setWatchLoading] = useState(true);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editTarget, setEditTarget] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortMode, setSortMode] = useState<"status" | "closest" | "name">("status");
  const [refreshing, setRefreshing] = useState(false);

  async function loadWatchlist(silent = false) {
    if (!silent) setWatchLoading(true);
    const { data, error } = await supabase
      .from("watchlist")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) console.log("Watchlist error:", error);
    else setWatchlist(data || []);
    if (!silent) setWatchLoading(false);
  }

  useFocusEffect(
    useCallback(() => {
      void loadWatchlist();
    }, [])
  );

  async function removeFromWatchlist(watchId: number) {
    const { error } = await supabase.from("watchlist").delete().eq("id", watchId);
    if (error) {
      console.log("Remove watchlist error:", error);
      return;
    }
    await loadWatchlist(true);
  }

  async function saveEditedTarget(watchId: number) {
    const value = Number(editTarget.replace(/,/g, ""));
    if (!Number.isFinite(value) || value <= 0) return;

    const { error } = await supabase
      .from("watchlist")
      .update({ target_price: value })
      .eq("id", watchId);
    if (error) {
      console.log("Update target error:", error);
      return;
    }

    setEditingId(null);
    setEditTarget("");
    await loadWatchlist(true);
  }

  const items = watchlist
    .map((watch) => {
      const product = products.find((item) => item.id === watch.product_id);
      if (!product) return null;

      const currentPrice = product.onlinePrice;
      const targetPrice = watch.target_price !== null ? Number(watch.target_price) : null;
      const targetHit =
        currentPrice !== null && targetPrice !== null && currentPrice <= targetPrice;
      const difference =
        currentPrice !== null && targetPrice !== null ? currentPrice - targetPrice : null;
      const progress =
        currentPrice !== null && targetPrice !== null && currentPrice > 0
          ? Math.max(0, Math.min(100, (targetPrice / currentPrice) * 100))
          : 0;

      return { watch, product, currentPrice, targetPrice, targetHit, difference, progress };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  const hits = items.filter((item) => item.targetHit).length;
  const pending = items.length - hits;
  const closestPending = items
    .filter((item) => !item.targetHit && item.difference !== null)
    .sort((a, b) => (a.difference || 0) - (b.difference || 0))[0] || null;

  let visible = items.filter((item) => {
    const q = searchQuery.trim().toLowerCase();
    return !q || item.product.name.toLowerCase().includes(q);
  });

  visible = [...visible].sort((a, b) => {
    if (sortMode === "name") return a.product.name.localeCompare(b.product.name);
    if (sortMode === "closest") {
      return Math.abs(a.difference ?? Number.MAX_SAFE_INTEGER) - Math.abs(b.difference ?? Number.MAX_SAFE_INTEGER);
    }
    if (a.targetHit !== b.targetHit) return a.targetHit ? -1 : 1;
    return Math.abs(a.difference ?? Number.MAX_SAFE_INTEGER) - Math.abs(b.difference ?? Number.MAX_SAFE_INTEGER);
  });

  async function onRefresh() {
    setRefreshing(true);
    await Promise.all([refresh(), loadWatchlist(true)]);
    setRefreshing(false);
  }

  if (loading || watchLoading) return <LoadingScreen />;
  if (error) return <ErrorScreen message={error} />;

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        contentContainerStyle={styles.container}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#35D07F" />
        }
      >
        <Text style={styles.title}>Watchlist</Text>
        <Text style={styles.subtitle}>Your target price command center</Text>

        <View style={styles.watchSummaryCard}>
          <View style={styles.watchSummaryItem}>
            <Text style={styles.priceLabel}>Alerts</Text>
            <Text style={styles.watchSummaryValue}>{items.length}</Text>
          </View>
          <View style={styles.watchSummaryItem}>
            <Text style={styles.priceLabel}>Target hit</Text>
            <Text style={[styles.watchSummaryValue, styles.priceDown]}>{hits}</Text>
          </View>
          <View style={styles.watchSummaryItem}>
            <Text style={styles.priceLabel}>Pending</Text>
            <Text style={styles.watchSummaryValue}>{pending}</Text>
          </View>
        </View>

        {closestPending && (
          <Pressable
            style={styles.closestCard}
            onPress={() => navigation.navigate("ProductDetail", { product: closestPending.product })}
          >
            <Text style={styles.closestLabel}>CLOSEST TO TARGET</Text>
            <Text style={styles.closestName}>{closestPending.product.name}</Text>
            <Text style={styles.closestGap}>{formatPrice(closestPending.difference)} away</Text>
          </Pressable>
        )}

        <View style={styles.searchBox}>
          <Ionicons name="search-outline" size={18} color="#7E899A" />
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search watchlist"
            placeholderTextColor="#596579"
            style={styles.searchInput}
          />
        </View>

        <View style={styles.sortRow}>
          <Text style={styles.sortLabel}>Sort</Text>
          {([
            ["status", "Status"],
            ["closest", "Closest"],
            ["name", "Name"],
          ] as const).map(([value, label]) => (
            <Pressable
              key={value}
              onPress={() => setSortMode(value)}
              style={[styles.sortChip, sortMode === value && styles.sortChipActive]}
            >
              <Text style={[styles.sortChipText, sortMode === value && styles.sortChipTextActive]}>{label}</Text>
            </Pressable>
          ))}
        </View>

        {visible.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="notifications-off-outline" size={30} color="#596579" />
            <Text style={styles.emptyTitle}>No watchlist items</Text>
            <Text style={styles.emptyText}>Set a target price from any product detail page.</Text>
          </View>
        ) : (
          visible.map((item) => (
            <View key={item.watch.id} style={styles.watchCard}>
              <View style={styles.productTopRow}>
                <Text style={styles.productType}>{item.product.category}</Text>
                <Text style={[styles.watchMiniStatus, item.targetHit && styles.watchMiniStatusHit]}>
                  {item.targetHit ? "TARGET HIT" : `${item.progress.toFixed(0)}% TO TARGET`}
                </Text>
              </View>

              <Text style={styles.productName}>{item.product.name}</Text>

              <View style={styles.watchPriceRow}>
                <View>
                  <Text style={styles.priceLabel}>Current</Text>
                  <Text style={styles.price}>{formatPrice(item.currentPrice)}</Text>
                </View>
                <View>
                  <Text style={styles.priceLabel}>Target</Text>
                  <Text style={styles.price}>{formatPrice(item.targetPrice)}</Text>
                </View>
              </View>

              <View style={styles.progressTrack}>
                <View
                  style={[
                    styles.progressFill,
                    { width: `${item.targetHit ? 100 : item.progress}%` },
                    item.targetHit && styles.progressFillHit,
                  ]}
                />
              </View>

              {item.targetPrice !== null && item.currentPrice !== null && (
                <View style={[styles.watchStatus, item.targetHit && styles.watchStatusHit]}>
                  <Text style={[styles.watchStatusText, item.targetHit && styles.watchStatusHitText]}>
                    {item.targetHit
                      ? `TARGET HIT ✅ • ${formatPrice(Math.abs(item.difference || 0))} below target`
                      : `${formatPrice(item.difference)} above target`}
                  </Text>
                </View>
              )}

              <Text style={styles.sourceText}>
                Best current source • {item.product.onlineSource || "Unknown"}
              </Text>

              <Pressable
                style={styles.viewProductButton}
                onPress={() => navigation.navigate("ProductDetail", { product: item.product })}
              >
                <Text style={styles.viewProductButtonText}>View Product</Text>
              </Pressable>

              {editingId === item.watch.id ? (
                <View style={styles.watchEditBox}>
                  <TextInput
                    value={editTarget}
                    onChangeText={setEditTarget}
                    placeholder="New target price"
                    placeholderTextColor="#6E7A90"
                    keyboardType="numeric"
                    style={styles.targetInput}
                  />
                  <View style={styles.watchActionRow}>
                    <Pressable style={styles.watchSmallButton} onPress={() => saveEditedTarget(item.watch.id)}>
                      <Text style={styles.watchButtonText}>Save</Text>
                    </Pressable>
                    <Pressable
                      style={styles.watchSmallButtonSecondary}
                      onPress={() => { setEditingId(null); setEditTarget(""); }}
                    >
                      <Text style={styles.watchSecondaryText}>Cancel</Text>
                    </Pressable>
                  </View>
                </View>
              ) : (
                <View style={styles.watchActionRow}>
                  <Pressable
                    style={styles.watchSmallButton}
                    onPress={() => {
                      setEditingId(item.watch.id);
                      setEditTarget(item.targetPrice ? String(item.targetPrice) : "");
                    }}
                  >
                    <Text style={styles.watchButtonText}>Edit Target</Text>
                  </Pressable>
                  <Pressable style={styles.watchRemoveButton} onPress={() => removeFromWatchlist(item.watch.id)}>
                    <Text style={styles.watchRemoveText}>Remove</Text>
                  </Pressable>
                </View>
              )}
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}


function AddProductScreen({ navigation }: any) {
  const [productUrl, setProductUrl] = useState("");
  const [detectedStore, setDetectedStore] = useState<SupportedStore | null>(null);
  const [productName, setProductName] = useState("");
  const [brand, setBrand] = useState("");
  const [sku, setSku] = useState("");
  const [category, setCategory] = useState<"GPU" | "RAM" | "SSD">("GPU");
  const [detectedPrice, setDetectedPrice] = useState<number | null>(null);
  const [inStock, setInStock] = useState(true);
  const [detecting, setDetecting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState<"info" | "success" | "error">("info");

  // Fast Refresh can preserve old component state. If a supported domain is already
  // detected, remove any legacy "Unsupported store URL" banner left from an older build.
  useEffect(() => {
    const normalized = normalizeProductUrl(productUrl);
    const store = normalized ? detectSupportedStore(normalized) : detectSupportedStore(productUrl);

    if (store) {
      setDetectedStore(store);
      if (/unsupported\s+store\s+url/i.test(message)) {
        setMessage("");
        setMessageType("info");
      }
    }
  }, [productUrl, message]);

  async function detectLink() {
    setMessage("");
    const normalized = normalizeProductUrl(productUrl);
    if (!normalized) {
      setMessageType("error");
      setMessage("Paste a valid https product link.");
      return;
    }

    // Keep the field canonical after scanning so malformed mobile pastes are corrected visibly.
    setProductUrl(normalized);

    const store = detectSupportedStore(normalized);
    if (!store) {
      setMessageType("error");
      setMessage("Store not supported yet. Use MDComputers, Vedant, PrimeABGB or Computech.");
      return;
    }

    setDetectedStore(store);
    setDetecting(true);
    setMessageType("info");
    setMessage(`Detected ${store.name}. Reading product page...`);

    try {
      const response = await fetch(normalized, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/151 Mobile Safari/537.36",
          Accept: "text/html,application/xhtml+xml",
        },
      });

      if (!response.ok) {
        throw new Error(`Store returned HTTP ${response.status}`);
      }

      const html = await response.text();
      const titleMatch =
        html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ||
        html.match(/<title[^>]*>([^<]+)<\/title>/i);

      const detectedName = titleMatch?.[1]
        ? cleanDetectedTitle(titleMatch[1])
        : "";
      const detectedSku = inferSkuFromText(html, normalized);
      const price = detectPriceFromHtml(html, store.name);
      const plainText = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").toLowerCase();
      const stock = !plainText.includes("out of stock") &&
        (plainText.includes("in stock") || plainText.includes("add to cart") || plainText.includes("buy now"));

      if (detectedName) {
        setProductName(detectedName);
        const inferredBrand = inferBrandFromName(detectedName);
        if (inferredBrand) setBrand(inferredBrand);
        const inferredCategory = inferCategoryFromProduct(detectedName);
        if (inferredCategory) setCategory(inferredCategory);
      }
      if (detectedSku) setSku(detectedSku);
      setDetectedPrice(price);
      setInStock(stock);

      setMessageType("success");
      setMessage(
        price !== null
          ? `Product detected • ${formatPrice(price)} • ${stock ? "In stock" : "Stock unclear / unavailable"}`
          : "Store detected. Confirm product name and exact SKU before adding. Price will be collected by the tracker."
      );
    } catch (error: any) {
      setDetectedPrice(null);
      setMessageType("info");
      setMessage(
        `${store.name} blocks direct app reading (${error?.message || "page unavailable"}). ` +
        "You can still add the link—confirm the exact product name and SKU below. Price will stay pending until a collector verifies it."
      );
    } finally {
      setDetecting(false);
    }
  }

  async function addAndTrack() {
    const normalized = normalizeProductUrl(productUrl);
    const store = detectedStore || detectSupportedStore(normalized);

    if (!normalized || !store) {
      setMessageType("error");
      setMessage("Detect a supported product link first.");
      return;
    }

    if (!productName.trim()) {
      setMessageType("error");
      setMessage("Product name is required.");
      return;
    }

    if (!sku.trim()) {
      setMessageType("error");
      setMessage("Exact SKU / model is required so different variants never get mixed.");
      return;
    }

    setSaving(true);
    setMessageType("info");
    setMessage("Adding product to tracker...");

    try {
      const { data, error } = await supabase.rpc("add_product_by_link", {
        p_product_url: normalized,
        p_store_name: store.name,
        p_name: productName.trim(),
        p_brand: brand.trim() || null,
        p_model: sku.trim().toUpperCase(),
        p_category: category,
        p_initial_price: detectedPrice,
        p_in_stock: inStock,
      });

      if (error) throw error;
const result = Array.isArray(data) ? data[0] : data;
const productId = result?.product_id ?? result?.id ?? null;
const reused = Boolean(result?.reused_existing_product);

const successText = reused
  ? "Same SKU was already tracked. This store link was added as another source."
  : "Product added and tracking source saved.";

setMessageType("success");
setMessage(successText + " ✅");

Alert.alert(
  "✅ Product Added",
  successText,
  [{ text: "OK" }]
);

    } catch (error: any) {
      const msg = error?.message || "Could not add product";
      if (msg.toLowerCase().includes("already")) {
        setMessageType("info");
        setMessage("This exact product link is already being tracked.");
      } else if (msg.toLowerCase().includes("function") || msg.toLowerCase().includes("rpc")) {
        setMessageType("error");
        setMessage("Database Add-by-Link function is missing. Run the supplied Supabase SQL once.");
      } else {
        setMessageType("error");
        setMessage(msg);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.addProductHero}>
          <View style={styles.addProductIconCircle}>
            <Ionicons name="link-outline" size={26} color="#35D07F" />
          </View>
          <Text style={styles.addProductTitle}>Add Product by Link</Text>
          <Text style={styles.addProductSubtitle}>
            Paste a store product URL. We keep exact SKU variants separate and attach additional stores to the same SKU.
          </Text>
        </View>

        <Text style={styles.formLabel}>Product link</Text>
        <View style={styles.addUrlRow}>
          <TextInput
            value={productUrl}
            onChangeText={(value) => {
              setProductUrl(value);
              const normalized = normalizeProductUrl(value);
              const store = normalized ? detectSupportedStore(normalized) : null;
              setDetectedStore(store);
              setDetectedPrice(null);

              // Clear stale validation banners while the user corrects a URL.
              if (store) {
                setMessage("");
                setMessageType("info");
              } else if (!value.trim()) {
                setMessage("");
              }
            }}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            placeholder="https://mdcomputers.in/product/..."
            placeholderTextColor="#596579"
            style={styles.addUrlInput}
          />
          <Pressable
            style={[styles.detectButton, detecting && styles.buttonDisabled]}
            disabled={detecting}
            onPress={detectLink}
          >
            {detecting ? (
              <ActivityIndicator size="small" color="#07120B" />
            ) : (
              <Ionicons name="scan-outline" size={19} color="#07120B" />
            )}
          </Pressable>
        </View>

        <View style={styles.supportedStoresRow}>
          {SUPPORTED_STORES.map((store) => (
            <View
              key={store.name}
              style={[
                styles.storePill,
                detectedStore?.name === store.name && styles.storePillActive,
              ]}
            >
              <Text
                style={[
                  styles.storePillText,
                  detectedStore?.name === store.name && styles.storePillTextActive,
                ]}
              >
                {store.name}
              </Text>
            </View>
          ))}
        </View>

        {message !== "" && !(detectedStore && /unsupported\s+store\s+url/i.test(message)) && (
          <View
            style={[
              styles.addMessage,
              messageType === "success" && styles.addMessageSuccess,
              messageType === "error" && styles.addMessageError,
            ]}
          >
            <Ionicons
              name={messageType === "success" ? "checkmark-circle" : messageType === "error" ? "alert-circle" : "information-circle"}
              size={18}
              color={messageType === "success" ? "#35D07F" : messageType === "error" ? "#FF6B6B" : "#F5B942"}
            />
            <Text style={styles.addMessageText}>{message}</Text>
          </View>
        )}

        <View style={styles.addFormCard}>
          <Text style={styles.formSectionTitle}>Confirm exact product</Text>

          <Text style={styles.formLabel}>Product name</Text>
          <TextInput
            value={productName}
            onChangeText={(value) => {
              setProductName(value);
              const inferred = inferBrandFromName(value);
              if (inferred && !brand.trim()) setBrand(inferred);
              const inferredCategory = inferCategoryFromProduct(value);
              if (inferredCategory) setCategory(inferredCategory);
            }}
            placeholder="Example: WD Black SN7100 2TB NVMe Gen4 SSD"
            placeholderTextColor="#596579"
            style={styles.formInput}
          />

          <Text style={styles.formLabel}>Brand (optional)</Text>
          <TextInput
            value={brand}
            onChangeText={setBrand}
            placeholder="Western Digital"
            placeholderTextColor="#596579"
            style={styles.formInput}
          />

          <Text style={styles.formLabel}>Exact SKU / model</Text>
          <TextInput
            value={sku}
            onChangeText={setSku}
            autoCapitalize="characters"
            placeholder="WDS200T4X0E"
            placeholderTextColor="#596579"
            style={styles.formInput}
          />
          <Text style={styles.formHint}>
            Required. This protects RTX 5060 vs 5060 Ti, 8GB vs 16GB, and other variants from being mixed.
          </Text>

          <Text style={styles.formLabel}>Category</Text>
          <View style={styles.categoryPickerRow}>
            {(["GPU", "RAM", "SSD"] as const).map((item) => (
              <Pressable
                key={item}
                onPress={() => setCategory(item)}
                style={[
                  styles.categoryChoice,
                  category === item && styles.categoryChoiceActive,
                ]}
              >
                <Ionicons
                  name={item === "GPU" ? "hardware-chip-outline" : item === "RAM" ? "layers-outline" : "save-outline"}
                  size={18}
                  color={category === item ? "#35D07F" : "#7E899A"}
                />
                <Text style={[styles.categoryChoiceText, category === item && styles.categoryChoiceTextActive]}>
                  {item}
                </Text>
              </Pressable>
            ))}
          </View>

          {(detectedPrice !== null || detectedStore) && (
            <View style={styles.detectedPreviewCard}>
              <View style={{ flex: 1 }}>
                <Text style={styles.detectedPreviewLabel}>Detected source</Text>
                <Text style={styles.detectedPreviewStore}>{detectedStore?.name || "Unknown"}</Text>
                <Text style={styles.detectedPreviewMeta}>{sku || "SKU awaiting confirmation"}</Text>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={styles.detectedPreviewLabel}>Current price</Text>
                <Text style={styles.detectedPreviewPrice}>
                  {detectedPrice !== null ? formatPrice(detectedPrice) : "Pending"}
                </Text>
                <Text style={inStock ? styles.detectedStock : styles.detectedOutStock}>
                  {detectedPrice === null
                    ? inStock
                      ? "Stock detected • price pending"
                      : "Price & stock pending"
                    : inStock
                    ? "In stock"
                    : "Stock unclear"}
                </Text>
              </View>
            </View>
          )}

          <Pressable
            style={[styles.addTrackButton, (saving || detecting) && styles.buttonDisabled]}
            disabled={saving || detecting}
            onPress={addAndTrack}
          >
            {saving ? (
              <ActivityIndicator size="small" color="#07120B" />
            ) : (
              <>
                <Ionicons name="add-circle-outline" size={20} color="#07120B" />
                <Text style={styles.addTrackButtonText}>Add & Track</Text>
              </>
            )}
          </Pressable>

          <Text style={styles.addSafetyNote}>
            A missing price is safer than a wrong price. If page detection fails, the source link is still saved and the collector can verify it later.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarHideOnKeyboard: true,
        tabBarIcon: ({ color, size }) => {
          const icons: Record<string, keyof typeof Ionicons.glyphMap> = {
            Home: "home-outline",
            GPU: "hardware-chip-outline",
            RAM: "layers-outline",
            SSD: "save-outline",
            Watchlist: "notifications-outline",
          };

          return (
            <Ionicons
              name={icons[route.name] || "ellipse-outline"}
              size={size}
              color={color}
            />
          );
        },
        tabBarStyle: {
          backgroundColor: "#111722",
          borderTopColor: "#222B39",
          height: 65,
        },
        tabBarActiveTintColor: "#35D07F",
        tabBarInactiveTintColor: "#7E899A",
        tabBarLabelStyle: {
          fontSize: 11,
          paddingBottom: 6,
        },
      })}
    >
      <Tab.Screen
        name="Home"
        component={HomeScreen}
      />

      <Tab.Screen name="GPU">
        {(props) => (
          <CategoryScreen
            {...props}
            type="GPU"
          />
        )}
      </Tab.Screen>

      <Tab.Screen name="RAM">
        {(props) => (
          <CategoryScreen
            {...props}
            type="RAM"
          />
        )}
      </Tab.Screen>

      <Tab.Screen name="SSD">
        {(props) => (
          <CategoryScreen
            {...props}
            type="SSD"
          />
        )}
      </Tab.Screen>

      <Tab.Screen
        name="Watchlist"
        component={WatchlistScreen}
      />
    </Tab.Navigator>
  );
}

export default function App() {
  return (
    <NavigationContainer>
      <Stack.Navigator>
        <Stack.Screen
          name="MainTabs"
          component={MainTabs}
          options={{
            headerShown: false,
          }}
        />

        <Stack.Screen
          name="ProductDetail"
          component={ProductDetailScreen}
          options={{
            title: "Price History",
            headerStyle: {
              backgroundColor: "#111722",
            },
            headerTintColor: "#FFFFFF",
          }}
        />

        <Stack.Screen
          name="AddProduct"
          component={AddProductScreen}
          options={{
            title: "Add Product",
            headerStyle: {
              backgroundColor: "#111722",
            },
            headerTintColor: "#FFFFFF",
          }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({

  productTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },

  roleBadge: {
    color: "#35D07F",
    fontSize: 10,
    fontWeight: "800",
    backgroundColor: "#173C2A",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
  },

  updatedText: {
    color: "#596579",
    fontSize: 10,
    marginTop: 8,
  },

  subSectionTitle: {
    color: "#AAB2C0",
    fontSize: 13,
    fontWeight: "800",
    marginTop: 18,
    marginBottom: 10,
  },

  currentTargetBox: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#101620",
    borderRadius: 12,
    padding: 12,
    marginBottom: 14,
  },

  currentTargetLabel: {
    color: "#8B95A7",
    fontSize: 12,
  },

  currentTargetValue: {
    color: "#35D07F",
    fontSize: 15,
    fontWeight: "800",
  },

  viewProductButton: {
    borderWidth: 1,
    borderColor: "#2B394B",
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
    marginTop: 14,
  },

  viewProductButtonText: {
    color: "#C5CBD5",
    fontSize: 13,
    fontWeight: "700",
  },
  safe: {
    flex: 1,
    backgroundColor: "#0B0F17",
  },

  container: {
    padding: 20,
    paddingBottom: 40,
  },

  center: {
    flex: 1,
    padding: 20,
    justifyContent: "center",
    alignItems: "center",
  },

  title: {
    color: "#FFFFFF",
    fontSize: 30,
    fontWeight: "800",
    marginTop: 10,
  },

  subtitle: {
    color: "#8B95A7",
    fontSize: 15,
    marginTop: 5,
    marginBottom: 25,
  },

  loadingText: {
    color: "#8B95A7",
    marginTop: 15,
  },

  errorTitle: {
    color: "#FF5B5B",
    fontSize: 20,
    fontWeight: "700",
    marginBottom: 10,
  },

  marketCard: {
    backgroundColor: "#151B26",
    borderRadius: 18,
    padding: 18,
    marginBottom: 25,
  },

  sectionTitle: {
    color: "#FFFFFF",
    fontSize: 20,
    fontWeight: "700",
    marginBottom: 16,
  },

  marketRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },

  marketLabel: {
    color: "#AAB2C0",
    fontSize: 14,
    marginBottom: 5,
  },

  marketValue: {
    color: "#35D07F",
    fontSize: 14,
    fontWeight: "700",
  },

  productCard: {
    backgroundColor: "#151B26",
    borderRadius: 18,
    padding: 18,
    marginBottom: 15,
  },

  productHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },

  productType: {
    color: "#6E7A90",
    fontSize: 12,
    fontWeight: "700",
  },

  productName: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "700",
    marginTop: 3,
  },

  priceRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 20,
  },

  priceLabel: {
    color: "#7E899A",
    fontSize: 12,
  },

  price: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "700",
    marginTop: 3,
  },

  statusBadge: {
    alignSelf: "flex-start",
    backgroundColor: "#173C2A",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    marginTop: 18,
  },

  priceBlock: {
  flex: 1,
},

sourceText: {
  color: "#6E7A90",
  fontSize: 12,
  marginTop: 4,
},

comparisonBox: {
  backgroundColor: "#101620",
  borderRadius: 12,
  padding: 12,
  marginTop: 16,
},

comparisonText: {
  color: "#35D07F",
  fontSize: 13,
  fontWeight: "700",
},

  statusText: {
    color: "#35D07F",
    fontSize: 12,
    fontWeight: "700",
  },

  emptyText: {
    color: "#8B95A7",
    fontSize: 15,
  },

  storeList: {
  marginTop: 16,
  paddingTop: 14,
  borderTopWidth: 1,
  borderTopColor: "#222B39",
},

storeListTitle: {
  color: "#8B95A7",
  fontSize: 12,
  fontWeight: "700",
  marginBottom: 10,
},

storeRow: {
  flexDirection: "row",
  justifyContent: "space-between",
  marginBottom: 8,
},

storeName: {
  color: "#C5CBD5",
  fontSize: 13,
},

storePrice: {
  color: "#FFFFFF",
  fontSize: 13,
  fontWeight: "700",
},

detailPrice: {
  color: "#FFFFFF",
  fontSize: 32,
  fontWeight: "800",
  marginTop: 5,
},

rangeRow: {
  flexDirection: "row",
  marginBottom: 20,
  gap: 10,
},

rangeButton: {
  paddingHorizontal: 18,
  paddingVertical: 9,
  borderRadius: 20,
  backgroundColor: "#151B26",
},

rangeButtonActive: {
  backgroundColor: "#173C2A",
},

rangeText: {
  color: "#8B95A7",
  fontWeight: "700",
},

rangeTextActive: {
  color: "#35D07F",
},

chart: {
  borderRadius: 16,
  marginBottom: 20,
},

statsRow: {
  flexDirection: "row",
  flexWrap: "wrap",
  justifyContent: "space-between",
  backgroundColor: "#151B26",
  padding: 16,
  borderRadius: 16,
  marginBottom: 25,
},

statsValue: {
  color: "#FFFFFF",
  fontSize: 15,
  fontWeight: "700",
  marginTop: 5,
},
changeCard: {
  backgroundColor: "#151B26",
  padding: 16,
  borderRadius: 16,
  marginBottom: 16,
},

changeValue: {
  fontSize: 24,
  fontWeight: "800",
  marginTop: 5,
},

changeAmount: {
  color: "#8B95A7",
  fontSize: 13,
  marginTop: 4,
},

priceDown: {
  color: "#35D07F",
},

priceUp: {
  color: "#FF5B5B",
},

statItem: {
  minWidth: "45%",
  marginBottom: 15,
},

matchBadge: {
  color: "#F5B942",
  fontSize: 11,
  fontWeight: "700",
  marginTop: 4,
},
marketPulseCard: {
  backgroundColor: "#151B26",
  borderRadius: 18,
  padding: 18,
  marginBottom: 22,
  borderWidth: 1,
  borderColor: "#35D07F",
},

marketPulseLabel: {
  color: "#35D07F",
  fontSize: 12,
  fontWeight: "800",
  marginBottom: 8,
},

marketPulseName: {
  color: "#FFFFFF",
  fontSize: 17,
  fontWeight: "700",
},

marketPulsePrice: {
  color: "#FFFFFF",
  fontSize: 30,
  fontWeight: "800",
  marginTop: 12,
},

marketPulseSource: {
  color: "#8B95A7",
  fontSize: 12,
  marginTop: 3,
  marginBottom: 14,
},

marketPulseStoreRow: {
  flexDirection: "row",
  justifyContent: "space-between",
  marginBottom: 7,
},

marketPulseStoreName: {
  color: "#C5CBD5",
  fontSize: 13,
},

marketPulseStorePrice: {
  color: "#FFFFFF",
  fontSize: 13,
  fontWeight: "700",
},

marketPulseHistory: {
  color: "#8B95A7",
  fontSize: 12,
  marginTop: 10,
},
marketPulseTrendRow: {
  flexDirection: "row",
  justifyContent: "space-between",
  marginTop: 10,
},
watchCard: {
  backgroundColor: "#151B26",
  borderRadius: 18,
  padding: 18,
  marginBottom: 15,
},

watchPriceRow: {
  flexDirection: "row",
  justifyContent: "space-between",
  marginTop: 18,
},

watchStatus: {
  backgroundColor: "#2A1D12",
  borderRadius: 12,
  padding: 12,
  marginTop: 16,
},

watchStatusHit: {
  backgroundColor: "#173C2A",
},

watchStatusText: {
  color: "#F5B942",
  fontSize: 13,
  fontWeight: "700",
},

watchStatusHitText: {
  color: "#35D07F",
},

watchSetupCard: {
  backgroundColor: "#151B26",
  borderRadius: 18,
  padding: 18,
  marginTop: 20,
  marginBottom: 30,
},

targetInput: {
  backgroundColor: "#101620",
  color: "#FFFFFF",
  borderRadius: 12,
  paddingHorizontal: 14,
  paddingVertical: 12,
  marginTop: 10,
  fontSize: 16,
},

watchButton: {
  backgroundColor: "#173C2A",
  borderRadius: 12,
  paddingVertical: 13,
  alignItems: "center",
  marginTop: 12,
},

watchButtonText: {
  color: "#35D07F",
  fontSize: 14,
  fontWeight: "800",
},

watchMessage: {
  color: "#8B95A7",
  fontSize: 12,
  marginTop: 10,
},
watchEditBox: {
  marginTop: 14,
},

watchActionRow: {
  flexDirection: "row",
  gap: 10,
  marginTop: 14,
},

watchSmallButton: {
  flex: 1,
  backgroundColor: "#173C2A",
  borderRadius: 10,
  paddingVertical: 11,
  alignItems: "center",
},

watchSmallButtonSecondary: {
  flex: 1,
  backgroundColor: "#101620",
  borderRadius: 10,
  paddingVertical: 11,
  alignItems: "center",
},

watchSecondaryText: {
  color: "#AAB2C0",
  fontSize: 13,
  fontWeight: "700",
},

watchRemoveButton: {
  flex: 1,
  backgroundColor: "#2A1717",
  borderRadius: 10,
  paddingVertical: 11,
  alignItems: "center",
},

watchRemoveText: {
  color: "#FF6B6B",
  fontSize: 13,
  fontWeight: "700",
},

targetHitCard: {
  backgroundColor: "#10251A",
  borderRadius: 18,
  padding: 16,
  marginBottom: 18,
  borderWidth: 1,
  borderColor: "#35D07F",
},

targetHitTitle: {
  color: "#35D07F",
  fontSize: 13,
  fontWeight: "800",
},

targetHitCount: {
  color: "#AAB2C0",
  fontSize: 12,
  marginTop: 4,
  marginBottom: 12,
},

targetHitRow: {
  flexDirection: "row",
  justifyContent: "space-between",
  alignItems: "center",
  backgroundColor: "#151B26",
  borderRadius: 12,
  padding: 12,
  marginTop: 8,
},

targetHitProduct: {
  color: "#FFFFFF",
  fontSize: 13,
  fontWeight: "700",
  paddingRight: 10,
},

targetHitMeta: {
  color: "#7E899A",
  fontSize: 11,
  marginTop: 3,
},

targetHitPrice: {
  color: "#35D07F",
  fontSize: 15,
  fontWeight: "800",
  textAlign: "right",
},

targetHitSaving: {
  color: "#8B95A7",
  fontSize: 10,
  marginTop: 3,
  textAlign: "right",
},
targetAlertStrip: {
  flexDirection: "row",
  justifyContent: "space-between",
  alignItems: "center",
  backgroundColor: "#10251A",
  borderWidth: 1,
  borderColor: "#35D07F",
  borderRadius: 12,
  paddingHorizontal: 14,
  paddingVertical: 11,
  marginBottom: 16,
},

targetAlertStripText: {
  color: "#35D07F",
  fontSize: 13,
  fontWeight: "800",
},

targetAlertStripAction: {
  color: "#FFFFFF",
  fontSize: 12,
  fontWeight: "700",
},

buttonDisabled: {
  opacity: 0.6,
},

removeAlertButton: {
  borderWidth: 1,
  borderColor: "#5B2A2A",
  borderRadius: 12,
  paddingVertical: 12,
  alignItems: "center",
  marginTop: 10,
},

removeAlertButtonText: {
  color: "#FF6B6B",
  fontSize: 13,
  fontWeight: "700",
},

modalOverlay: {
  flex: 1,
  backgroundColor: "rgba(0,0,0,0.75)",
  justifyContent: "center",
  alignItems: "center",
  padding: 24,
},

targetModal: {
  width: "100%",
  backgroundColor: "#151B26",
  borderRadius: 22,
  padding: 22,
  borderWidth: 1,
  borderColor: "#35D07F",
},

targetModalEmoji: {
  fontSize: 34,
  textAlign: "center",
  marginBottom: 10,
},

targetModalTitle: {
  color: "#35D07F",
  fontSize: 22,
  fontWeight: "800",
  textAlign: "center",
},

targetModalProduct: {
  color: "#FFFFFF",
  fontSize: 17,
  fontWeight: "700",
  textAlign: "center",
  marginTop: 14,
},

targetModalPriceRow: {
  flexDirection: "row",
  justifyContent: "space-between",
  marginTop: 22,
},

targetModalPrice: {
  color: "#FFFFFF",
  fontSize: 20,
  fontWeight: "800",
  marginTop: 4,
},

targetModalSaving: {
  color: "#35D07F",
  fontSize: 14,
  fontWeight: "700",
  textAlign: "center",
  marginTop: 18,
},

modalPrimaryButton: {
  backgroundColor: "#173C2A",
  borderRadius: 12,
  paddingVertical: 13,
  alignItems: "center",
  marginTop: 20,
},

modalPrimaryButtonText: {
  color: "#35D07F",
  fontSize: 14,
  fontWeight: "800",
},

modalDismissButton: {
  paddingVertical: 12,
  alignItems: "center",
  marginTop: 6,
},

modalDismissText: {
  color: "#8B95A7",
  fontSize: 13,
  fontWeight: "700",
},

  productBadgeRow: {
    flexDirection: "row",
    gap: 6,
    alignItems: "center",
  },

  freshnessBadge: {
    color: "#35D07F",
    fontSize: 9,
    fontWeight: "800",
    backgroundColor: "#10251A",
    paddingHorizontal: 7,
    paddingVertical: 4,
    borderRadius: 10,
  },

  freshnessBadgeStale: {
    color: "#F5B942",
    backgroundColor: "#2A1D12",
  },

  dashboardGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    marginBottom: 8,
  },

  dashboardCard: {
    width: "48.5%",
    backgroundColor: "#151B26",
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
  },

  dashboardLabel: {
    color: "#7E899A",
    fontSize: 11,
    fontWeight: "700",
  },

  dashboardValue: {
    color: "#FFFFFF",
    fontSize: 26,
    fontWeight: "800",
    marginTop: 5,
  },

  dashboardValueSmall: {
    color: "#FFFFFF",
    fontSize: 19,
    fontWeight: "800",
    marginTop: 8,
  },

  dashboardMeta: {
    color: "#596579",
    fontSize: 10,
    marginTop: 4,
  },

  miniChart: {
    borderRadius: 14,
    marginTop: 12,
    marginLeft: -8,
  },

  dealsCard: {
    backgroundColor: "#151B26",
    borderRadius: 18,
    padding: 16,
    marginBottom: 22,
  },

  sectionHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },

  sectionHint: {
    color: "#596579",
    fontSize: 10,
    marginBottom: 16,
  },

  dealRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: "#222B39",
  },

  dealRank: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#173C2A",
    alignItems: "center",
    justifyContent: "center",
  },

  dealRankText: {
    color: "#35D07F",
    fontWeight: "800",
    fontSize: 12,
  },

  dealName: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "700",
  },

  dealMeta: {
    color: "#7E899A",
    fontSize: 10,
    marginTop: 3,
  },

  dealSaving: {
    color: "#35D07F",
    fontWeight: "800",
    fontSize: 13,
  },

  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#151B26",
    borderRadius: 14,
    paddingHorizontal: 13,
    marginBottom: 12,
  },

  searchInput: {
    flex: 1,
    color: "#FFFFFF",
    paddingVertical: 12,
    paddingHorizontal: 10,
    fontSize: 14,
  },

  chipScroller: {
    marginBottom: 12,
  },

  filterChip: {
    backgroundColor: "#151B26",
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginRight: 8,
  },

  filterChipActive: {
    backgroundColor: "#173C2A",
  },

  filterChipText: {
    color: "#8B95A7",
    fontSize: 12,
    fontWeight: "700",
  },

  filterChipTextActive: {
    color: "#35D07F",
  },

  sortRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    marginBottom: 16,
  },

  sortLabel: {
    color: "#596579",
    fontSize: 11,
    marginRight: 3,
  },

  sortChip: {
    backgroundColor: "#101620",
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },

  sortChipActive: {
    backgroundColor: "#173C2A",
  },

  sortChipText: {
    color: "#7E899A",
    fontSize: 10,
    fontWeight: "700",
  },

  sortChipTextActive: {
    color: "#35D07F",
  },

  emptyCard: {
    backgroundColor: "#151B26",
    borderRadius: 18,
    padding: 28,
    alignItems: "center",
    marginBottom: 20,
  },

  emptyTitle: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "700",
    marginTop: 8,
    marginBottom: 5,
  },

  categorySummaryCard: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    backgroundColor: "#151B26",
    borderRadius: 18,
    padding: 16,
    marginBottom: 16,
  },

  categoryStat: {
    width: "48%",
    marginBottom: 14,
  },

  categoryStatValue: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "800",
    marginTop: 4,
  },

  detailHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },

  iconButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "#151B26",
    alignItems: "center",
    justifyContent: "center",
  },

  intelligenceCard: {
    backgroundColor: "#151B26",
    borderRadius: 18,
    padding: 16,
    marginBottom: 18,
  },

  intelligenceGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
  },

  intelligenceItem: {
    width: "48%",
    backgroundColor: "#101620",
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
  },

  intelligenceValue: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "800",
    marginTop: 5,
  },

  intelligenceMeta: {
    color: "#596579",
    fontSize: 9,
    marginTop: 4,
  },

  bestStoreRow: {
    backgroundColor: "#10251A",
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },

  bestStoreLabel: {
    color: "#35D07F",
    fontSize: 8,
    fontWeight: "800",
    marginTop: 2,
  },

  watchSummaryCard: {
    flexDirection: "row",
    justifyContent: "space-between",
    backgroundColor: "#151B26",
    borderRadius: 18,
    padding: 16,
    marginBottom: 14,
  },

  watchSummaryItem: {
    alignItems: "center",
    flex: 1,
  },

  watchSummaryValue: {
    color: "#FFFFFF",
    fontSize: 22,
    fontWeight: "800",
    marginTop: 4,
  },

  closestCard: {
    backgroundColor: "#10251A",
    borderRadius: 16,
    padding: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: "#173C2A",
  },

  closestLabel: {
    color: "#35D07F",
    fontSize: 9,
    fontWeight: "800",
  },

  closestName: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "700",
    marginTop: 5,
  },

  closestGap: {
    color: "#AAB2C0",
    fontSize: 11,
    marginTop: 4,
  },

  watchMiniStatus: {
    color: "#F5B942",
    fontSize: 9,
    fontWeight: "800",
    backgroundColor: "#2A1D12",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
  },

  watchMiniStatusHit: {
    color: "#35D07F",
    backgroundColor: "#10251A",
  },

  progressTrack: {
    height: 7,
    backgroundColor: "#101620",
    borderRadius: 6,
    overflow: "hidden",
    marginTop: 14,
  },

  progressFill: {
    height: "100%",
    backgroundColor: "#F5B942",
    borderRadius: 6,
  },

  progressFillHit: {
    backgroundColor: "#35D07F",
  },



  addProductQuickButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#121B1A",
    borderWidth: 1,
    borderColor: "#214B35",
    borderRadius: 16,
    padding: 14,
    marginBottom: 18,
    gap: 12,
  },
  addProductQuickIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: "#35D07F",
    alignItems: "center",
    justifyContent: "center",
  },
  addProductQuickTitle: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "800",
  },
  addProductQuickText: {
    color: "#7E899A",
    fontSize: 11,
    marginTop: 3,
  },
  addProductHero: {
    alignItems: "center",
    marginBottom: 24,
  },
  addProductIconCircle: {
    width: 58,
    height: 58,
    borderRadius: 20,
    backgroundColor: "#11271C",
    borderWidth: 1,
    borderColor: "#245C3D",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  addProductTitle: {
    color: "#FFFFFF",
    fontSize: 25,
    fontWeight: "800",
  },
  addProductSubtitle: {
    color: "#8B95A7",
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center",
    marginTop: 7,
  },
  addUrlRow: {
    flexDirection: "row",
    gap: 9,
    marginBottom: 10,
  },
  addUrlInput: {
    flex: 1,
    backgroundColor: "#151B26",
    borderWidth: 1,
    borderColor: "#222B39",
    borderRadius: 13,
    paddingHorizontal: 13,
    paddingVertical: 12,
    color: "#FFFFFF",
    fontSize: 13,
  },
  detectButton: {
    width: 48,
    borderRadius: 13,
    backgroundColor: "#35D07F",
    alignItems: "center",
    justifyContent: "center",
  },
  supportedStoresRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 7,
    marginBottom: 16,
  },
  storePill: {
    backgroundColor: "#151B26",
    borderWidth: 1,
    borderColor: "#222B39",
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  storePillActive: {
    borderColor: "#35D07F",
    backgroundColor: "#11271C",
  },
  storePillText: {
    color: "#7E899A",
    fontSize: 10,
    fontWeight: "700",
  },
  storePillTextActive: {
    color: "#35D07F",
  },
  addMessage: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 9,
    backgroundColor: "#2A2312",
    borderRadius: 12,
    padding: 12,
    marginBottom: 14,
  },
  addMessageSuccess: {
    backgroundColor: "#11271C",
  },
  addMessageError: {
    backgroundColor: "#2A1717",
  },
  addMessageText: {
    flex: 1,
    color: "#C5CBD5",
    fontSize: 12,
    lineHeight: 17,
  },
  addFormCard: {
    backgroundColor: "#151B26",
    borderRadius: 18,
    padding: 17,
    marginBottom: 30,
  },
  formSectionTitle: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "800",
    marginBottom: 16,
  },
  formLabel: {
    color: "#AAB2C0",
    fontSize: 12,
    fontWeight: "700",
    marginBottom: 7,
    marginTop: 10,
  },
  formInput: {
    backgroundColor: "#101620",
    borderWidth: 1,
    borderColor: "#222B39",
    borderRadius: 12,
    paddingHorizontal: 13,
    paddingVertical: 12,
    color: "#FFFFFF",
    fontSize: 14,
  },
  formHint: {
    color: "#657186",
    fontSize: 10,
    lineHeight: 15,
    marginTop: 6,
  },
  categoryPickerRow: {
    flexDirection: "row",
    gap: 8,
  },
  categoryChoice: {
    flex: 1,
    flexDirection: "row",
    gap: 6,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#101620",
    borderWidth: 1,
    borderColor: "#222B39",
    borderRadius: 11,
    paddingVertical: 11,
  },
  categoryChoiceActive: {
    borderColor: "#35D07F",
    backgroundColor: "#11271C",
  },
  categoryChoiceText: {
    color: "#7E899A",
    fontSize: 12,
    fontWeight: "800",
  },
  categoryChoiceTextActive: {
    color: "#35D07F",
  },
  detectedPreviewCard: {
    flexDirection: "row",
    justifyContent: "space-between",
    backgroundColor: "#101620",
    borderRadius: 13,
    padding: 13,
    marginTop: 17,
    borderWidth: 1,
    borderColor: "#263143",
  },
  detectedPreviewLabel: {
    color: "#657186",
    fontSize: 10,
  },
  detectedPreviewStore: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "800",
    marginTop: 3,
  },
  detectedPreviewMeta: {
    color: "#7E899A",
    fontSize: 10,
    marginTop: 3,
  },
  detectedPreviewPrice: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "800",
    marginTop: 3,
  },
  detectedStock: {
    color: "#35D07F",
    fontSize: 10,
    fontWeight: "700",
    marginTop: 3,
  },
  detectedOutStock: {
    color: "#F5B942",
    fontSize: 10,
    fontWeight: "700",
    marginTop: 3,
  },
  addTrackButton: {
    flexDirection: "row",
    gap: 8,
    backgroundColor: "#35D07F",
    borderRadius: 13,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 18,
  },
  addTrackButtonText: {
    color: "#07120B",
    fontSize: 14,
    fontWeight: "900",
  },
  addSafetyNote: {
    color: "#657186",
    fontSize: 10,
    lineHeight: 15,
    textAlign: "center",
    marginTop: 10,
  },
});