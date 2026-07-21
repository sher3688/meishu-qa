import { useState, useMemo, useEffect } from "react";
import { ChevronDown, Search, Download, Plus, LogOut, LogIn, Edit2, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { categories, faqItems as staticFAQItems } from "@/data/faqData";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";

export default function Home() {
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [hasError, setHasError] = useState<boolean>(false);
  const { user, logout } = useAuth();
  const [, setLocation] = useLocation();

  // Fetch FAQ data from database
  const { data: dbFAQs = [], isLoading, error: faqError, refetch } = trpc.faq.list.useQuery();
  const trpcUtils = trpc.useUtils();
  const deleteFAQMutation = trpc.faq.delete.useMutation({
    onSuccess: () => {
      trpcUtils.faq.list.invalidate();
    },
  });

  // Track error state
  useEffect(() => {
    if (faqError) {
      console.error("[FAQ] Error loading FAQs:", faqError);
      setHasError(true);
    }
  }, [faqError]);

  // Refetch when returning to home page
  useEffect(() => {
    console.log("[FAQ] Refetching data...");
    refetch();
  }, [refetch]);

  // Log loading state changes
  useEffect(() => {
    console.log("[FAQ] Loading state:", { isLoading, dataLength: dbFAQs.length });
  }, [isLoading, dbFAQs.length]);

  const handleDeleteFAQ = (id: number) => {
    if (confirm("確定要刪除此問答嗎？")) {
      console.log("[FAQ Delete] Deleting FAQ with id:", id);
      deleteFAQMutation.mutate({ id });
    }
  };

  // Use only database FAQs (all FAQs are now in database)
  const allFAQs = useMemo(() => {
    // Convert database FAQs
    return Array.isArray(dbFAQs)
      ? dbFAQs.map((faq: any) => {
          // CRITICAL FIX: Normalize imageUrls from string to array
          let imageUrls: string[] = [];
          if (faq.imageUrls) {
            if (Array.isArray(faq.imageUrls)) {
              imageUrls = faq.imageUrls;
            } else if (typeof faq.imageUrls === 'string') {
              try {
                const parsed = JSON.parse(faq.imageUrls);
                imageUrls = Array.isArray(parsed) ? parsed : [];
              } catch (e) {
                console.warn('[FAQ] Failed to parse imageUrls:', faq.imageUrls, e);
                imageUrls = [];
              }
            }
          }
          
          return {
            id: `q${faq.id}`,
            question: faq.question,
            answer: faq.answer,
            category: faq.category,
            dbId: faq.id,
            imageUrls,
          };
        })
      : [];
  }, [dbFAQs]);

  // Debug: Log when data loads
  useEffect(() => {
    if (!isLoading) {
      console.log("[FAQ Data] Loaded:", { 
        dbCount: dbFAQs.length, 
        allFAQsCount: allFAQs.length,
        selectedCategory,
        searchQuery,
        firstItem: allFAQs[0]
      });
    }
  }, [isLoading, allFAQs, selectedCategory, searchQuery]);

  // Filter FAQ items based on category and search query
  const filteredItems = useMemo(() => {
    if (allFAQs.length === 0) {
      console.log("[FAQ Filter] No FAQs to filter");
      return [];
    }
    
    const filtered = allFAQs.filter((item) => {
      // If selectedCategory is "all", show all items; otherwise filter by category
      const matchesCategory =
        selectedCategory === "all" || item.category === selectedCategory;
      
      // Check if search query matches question or answer
      const matchesSearch =
        searchQuery === "" ||
        item.question.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.answer.toLowerCase().includes(searchQuery.toLowerCase());
      
      return matchesCategory && matchesSearch;
    });
    
    console.log("[FAQ Filter] Filtered items:", { 
      total: allFAQs.length, 
      filtered: filtered.length, 
      selectedCategory,
      searchQuery 
    });
    return filtered;
  }, [allFAQs, selectedCategory, searchQuery]);

  const toggleExpand = (id: string) => {
    setExpandedId(expandedId === id ? null : id);
  };

  const handleLogout = async () => {
    await logout();
    setLocation("/");
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white shadow-sm border-b border-border">
        <div className="container py-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-primary rounded-lg flex items-center justify-center">
                <span className="text-white font-bold text-lg">🏢</span>
              </div>
              <div>
                <h1 className="text-xl font-bold text-foreground">美樹大悅社區</h1>
                <p className="text-xs text-muted-foreground">住戶常用問答</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {user ? (
                <>
                  {user.role === "admin" && (
                    <Button
                      variant="default"
                      size="sm"
                      onClick={() => setLocation("/admin")}
                      className="gap-2"
                    >
                      <Plus className="w-4 h-4" />
                      新增問答
                    </Button>
                  )}
                  <div className="text-sm text-muted-foreground">
                    {user.name} ({user.role})
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleLogout}
                    className="gap-2"
                  >
                    <LogOut className="w-4 h-4" />
                    登出
                  </Button>
                </>
              ) : (
                <Button
                  variant="default"
                  size="sm"
                  onClick={() => (window.location.href = getLoginUrl())}
                  className="gap-2"
                >
                  <LogIn className="w-4 h-4" />
                  登入
                </Button>
              )}
            </div>
          </div>

          {/* Search Bar */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-5 h-5" />
            <Input
              type="text"
              placeholder="搜尋問題或答案..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 pr-4 py-2 w-full"
            />
          </div>
        </div>
      </header>

      <main className="container py-8">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
          {/* Sidebar - Categories */}
          <aside className="lg:col-span-1">
            <div className="sticky top-24 space-y-2">
              <h2 className="text-lg font-semibold text-foreground mb-4">
                分類篩選
              </h2>
              {categories.map((category) => (
                <button
                  key={category.id}
                  onClick={() => setSelectedCategory(category.id)}
                  className={`category-badge w-full text-left transition-all duration-200 ${
                    selectedCategory === category.id
                      ? "active"
                      : "inactive"
                  }`}
                >
                  <span className="mr-2">{category.icon}</span>
                  {category.name}
                </button>
              ))}

              {/* Download Section */}
              <div className="mt-8 pt-6 border-t border-border">
                <h3 className="text-sm font-semibold text-foreground mb-3">
                  📋 完整管理規約
                </h3>
                <p className="text-xs text-muted-foreground mb-3">
                  下載美樹大悅社區住戶管理規約（修訂版）
                </p>
                <Button
                  variant="default"
                  size="sm"
                  className="w-full gap-2"
                  onClick={() => {
                    // Placeholder for PDF download
                    alert("管理規約下載功能即將上線");
                  }}
                >
                  <Download className="w-4 h-4" />
                  下載 PDF
                </Button>
              </div>
            </div>
          </aside>

          {/* Main Content - FAQ Items */}
          <section className="lg:col-span-3">
            <div className="mb-6">
              <p className="text-sm text-muted-foreground">
                共 <span className="font-semibold text-foreground">{filteredItems.length}</span> 個問題
              </p>
            </div>

            <div className="space-y-3">
              <AnimatePresence mode="popLayout">
                {filteredItems.length > 0 ? (
                  filteredItems.map((item, index) => (
                    <motion.div
                      key={item.id}
                      layout
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -20 }}
                      transition={{
                        duration: 0.3,
                        delay: index * 0.05,
                      }}
                    >
                      <div
                        className={`faq-card p-4 cursor-pointer ${
                          expandedId === item.id ? "active" : ""
                        }`}
                        onClick={() => toggleExpand(item.id)}
                      >
                        {/* Question Header */}
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-xs font-semibold text-primary bg-blue-50 px-2 py-1 rounded">
                                {item.id.toUpperCase()}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                {categories.find(
                                  (c) => c.id === item.category
                                )?.name}
                              </span>
                            </div>
                            <h3 className="text-base font-semibold text-foreground">
                              {item.question}
                            </h3>
                          </div>
                          <motion.div
                            animate={{
                              rotate: expandedId === item.id ? 180 : 0,
                            }}
                            transition={{ duration: 0.3 }}
                            className="flex-shrink-0"
                          >
                            <ChevronDown className="w-5 h-5 text-primary" />
                          </motion.div>
                        </div>

                        {/* Answer - Expandable */}
                        <AnimatePresence>
                          {expandedId === item.id && (
                            <motion.div
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: "auto" }}
                              exit={{ opacity: 0, height: 0 }}
                              transition={{ duration: 0.3 }}
                              className="mt-4 pt-4 border-t border-border"
                            >
                              <p className="text-sm text-foreground leading-relaxed mb-4">
                                {item.answer}
                              </p>

                              {/* Images */}
                              {(() => {
                                const imgs = Array.isArray((item as any).imageUrls) ? (item as any).imageUrls : [];
                                return imgs.length > 0 ? (
                                  <div className="mt-4 grid grid-cols-2 md:grid-cols-3 gap-3">
                                    {imgs.map((url: string, idx: number) => (
                                      <img
                                        key={idx}
                                        src={url}
                                        alt={`Answer image ${idx + 1}`}
                                        className="w-full h-32 object-cover rounded-lg"
                                      />
                                    ))}
                                  </div>
                                ) : null;
                              })()}

                              {/* Admin Actions */}
                              {user?.role === "admin" && (
                                <div className="flex gap-2 pt-4 border-t border-border">
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => {
                                      const faqId = (item as any).dbId;
                                      setLocation(`/edit/${faqId}`);
                                    }}
                                    className="gap-2"
                                  >
                                    <Edit2 className="w-4 h-4" />
                                    編輯
                                  </Button>
                                  <Button
                                    variant="destructive"
                                    size="sm"
                                    onClick={() => {
                                      const faqId = (item as any).dbId;
                                      handleDeleteFAQ(faqId);
                                    }}
                                    className="gap-2"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                    刪除
                                  </Button>
                                </div>
                              )}
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    </motion.div>
                  ))
                ) : isLoading ? (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="text-center py-12"
                  >
                    <p className="text-muted-foreground">
                      加載中...
                    </p>
                  </motion.div>
                ) : hasError ? (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="text-center py-12"
                  >
                    <p className="text-red-500">
                      無法加載問答數據，請稍後重試
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setHasError(false);
                        refetch();
                      }}
                      className="mt-4"
                    >
                      重新加載
                    </Button>
                  </motion.div>
                ) : (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="text-center py-12"
                  >
                    <p className="text-muted-foreground">
                      找不到相關問題，請嘗試其他搜尋條件
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Footer Info */}
            <div className="mt-12 pt-8 border-t border-border">
              <p className="text-xs text-muted-foreground text-center">
                共 <span className="font-semibold">{allFAQs.length}</span> 個常見問題 •{" "}
                <span className="font-semibold">{categories.length - 1}</span> 個主題分類
              </p>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
