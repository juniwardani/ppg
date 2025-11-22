class DigitalBook {
  constructor() {
    this.currentPage = 0;
    this.totalPages = 241;
    this.book = document.getElementById('book');
    this.pageNumber = document.getElementById('pageNumber');
    this.prevBtn = document.getElementById('prevBtn');
    this.nextBtn = document.getElementById('nextBtn');
    this.fullscreenBtn = document.getElementById('fullscreenBtn');
    this.tocBtn = document.getElementById('tocBtn');
    this.tocOverlay = document.getElementById('tocOverlay');
    this.tocList = document.getElementById('tocList');
    this.isFullscreen = false;
    this.loadedPages = new Set();
    this.isNavigating = false;
    
    // Inisialisasi chapter titles
    this.chapterTitles = [
        { title: "Halaman Cover", page: 1 },
        { title: "PERKEMBANGAN ARAB-MELAYU", page: 2 },
        { title: "MENGENAL HURUF ARAB-MELAYU", page: 5 },
        { title: "HURUF TAMBAHAN", page: 7 },
        { title: "KARAKTERISTIK ARAB-MELAYU", page: 9 },
        { title: "KAIDAH PENULISAN", page: 17 }
    ];
    
    this.appContainer = document.querySelector('.app-container');
    this.hideControlsTimeout = null;
    
    // Inisialisasi IndexedDB
    this.initializeDB().then(() => {
        this.initializeBook();
        this.initializeTouchNavigation();
        this.initializeButtons();
        this.initializeFullscreenChange();
        this.initializeTableOfContents();
        this.initializeFullscreenControls();
        this.updateNavigation();
        this.cacheAllPages();
    });
  }

  async initializeDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('digitalBookDB', 1);
        
        request.onerror = () => reject(request.error);
        
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains('pages')) {
                db.createObjectStore('pages');
            }
        };
        
        request.onsuccess = () => {
            this.db = request.result;
            resolve();
        };
    });
  }

  async loadPage(pageElement, pageIndex) {
    if (pageIndex < 0 || pageIndex >= this.totalPages) {
        pageElement.innerHTML = '';
        return;
    }
    
    // Jika halaman sudah dimuat dengan index yang sama, tidak perlu memuat ulang
    if (pageElement.dataset.pageIndex && parseInt(pageElement.dataset.pageIndex) === pageIndex) {
        return;
    }
    
    const img = document.createElement('img');
    const pageKey = `page_${pageIndex + 1}`;
    
    try {
        // Coba ambil dari IndexedDB
        const cachedImage = await this.getFromDB(pageKey);
        
        if (cachedImage) {
            // Gunakan gambar dari cache
            img.src = cachedImage;
            img.alt = `Page ${pageIndex + 1}`;
            img.decoding = 'async';
            
            pageElement.innerHTML = '';
            pageElement.appendChild(img);
            pageElement.dataset.pageIndex = pageIndex;
            this.loadedPages.add(pageIndex);
        } else {
            // Tampilkan loading placeholder
            pageElement.innerHTML = '<div class="loading-placeholder">Memuat halaman...</div>';
            
            // Load gambar dari server
            const response = await fetch(`scan/${pageIndex + 1}.jpg`);
            if (!response.ok) throw new Error('Network response was not ok');
            
            const blob = await response.blob();
            const base64data = await this.blobToBase64(blob);
            
            // Simpan ke IndexedDB
            await this.saveToDB(pageKey, base64data);
            
            // Tampilkan gambar jika pageElement masih memiliki index yang sama
            if (pageElement.dataset.pageIndex && parseInt(pageElement.dataset.pageIndex) === pageIndex) {
                img.src = base64data;
                img.alt = `Page ${pageIndex + 1}`;
                img.decoding = 'async';
                pageElement.innerHTML = '';
                pageElement.appendChild(img);
            }
        }
        
        pageElement.dataset.pageIndex = pageIndex;
        this.loadedPages.add(pageIndex);
        
    } catch (error) {
        console.error('Error loading image:', error);
        pageElement.innerHTML = `
            <div class="error-placeholder">
                Gagal memuat halaman ${pageIndex + 1}
                <button onclick="this.closest('.page').dispatchEvent(new CustomEvent('retry-load'))">
                    Coba lagi
                </button>
            </div>
        `;
    }
  }

  async getFromDB(key) {
    return new Promise((resolve, reject) => {
        const transaction = this.db.transaction(['pages'], 'readonly');
        const store = transaction.objectStore('pages');
        const request = store.get(key);
        
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
  }

  async saveToDB(key, value) {
    return new Promise((resolve, reject) => {
        const transaction = this.db.transaction(['pages'], 'readwrite');
        const store = transaction.objectStore('pages');
        const request = store.put(value, key);
        
        request.onsuccess = () => resolve();
        request.onerror = async (e) => {
            if (e.target.error.name === 'QuotaExceededError') {
                try {
                    await this.clearOldCache();
                    // Coba simpan lagi setelah membersihkan cache
                    const retryTransaction = this.db.transaction(['pages'], 'readwrite');
                    const retryStore = retryTransaction.objectStore('pages');
                    const retryRequest = retryStore.put(value, key);
                    retryRequest.onsuccess = () => resolve();
                    retryRequest.onerror = () => reject(e.target.error);
                } catch (clearError) {
                    reject(clearError);
                }
            } else {
                reject(e.target.error);
            }
        };
    });
  }

  blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
  }

  async clearOldCache() {
    return new Promise(async (resolve, reject) => {
        try {
            const transaction = this.db.transaction(['pages'], 'readwrite');
            const store = transaction.objectStore('pages');
            
            // Dapatkan semua key yang ada
            const keys = await new Promise((resolve, reject) => {
                const request = store.getAllKeys();
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });
            
            // Hitung berapa key yang akan dihapus (50% dari total)
            const keysToRemove = Math.ceil(keys.length * 0.5);
            
            // Urutkan key dan ambil yang paling lama
            const keysToDelete = keys.sort().slice(0, keysToRemove);
            
            // Hapus key-key lama
            for (const key of keysToDelete) {
                await new Promise((resolve, reject) => {
                    const request = store.delete(key);
                    request.onsuccess = () => resolve();
                    request.onerror = () => reject(request.error);
                });
            }
            
            resolve();
        } catch (error) {
            reject(error);
        }
    });
  }

  initializeBook() {
    // Bersihkan book container
    this.book.innerHTML = '';
    
    // Buat 3 halaman untuk viewport
    for (let i = -1; i <= 1; i++) {
      const page = document.createElement('div');
      page.className = 'page';
      this.book.appendChild(page);
    }
    
    // Load halaman awal
    this.updatePagePositions();
  }

  updatePagePositions() {
    const pages = Array.from(this.book.children);
    
    pages.forEach((page, i) => {
      const pageIndex = this.currentPage + (i - 1);
      
      if (pageIndex < 0 || pageIndex >= this.totalPages) {
        page.style.display = 'none';
      } else {
        page.style.display = 'flex';
        if (i === 0) {
          page.className = 'page prev';
        } else if (i === 1) {
          page.className = 'page active';
        } else {
          page.className = 'page next';
        }
        
        this.loadPage(page, pageIndex);
      }
    });
  }

  nextPage() {
    if (this.isNavigating || this.currentPage >= this.totalPages - 1) return;
    
    this.isNavigating = true;
    this.currentPage++;
    this.loadPage(this.book.children[1], this.currentPage);
    this.updatePagePositions();
    this.updateNavigation();
    
    setTimeout(() => {
      this.isNavigating = false;
    }, 300);
  }

  previousPage() {
    if (this.isNavigating || this.currentPage <= 0) return;
    
    this.isNavigating = true;
    this.currentPage--;
    this.loadPage(this.book.children[1], this.currentPage);
    this.updatePagePositions();
    this.updateNavigation();
    
    setTimeout(() => {
      this.isNavigating = false;
    }, 300);
  }

  updateNavigation() {
    this.pageNumber.textContent = this.currentPage + 1;
    this.prevBtn.disabled = this.currentPage === 0;
    this.nextBtn.disabled = this.currentPage === this.totalPages - 1;
  }
  
  

  initializeTouchNavigation() {
    let touchStartX = 0;
    
    const handleTouchStart = (e) => {
      if (this.isNavigating) return;
      touchStartX = e.touches[0].clientX;
    };
    
    const handleTouchEnd = (e) => {
      if (this.isNavigating) return;
      
      const touchEndX = e.changedTouches[0].clientX;
      const deltaX = touchEndX - touchStartX;
      
      if (Math.abs(deltaX) > 50) {
        if (deltaX > 0) {
          this.previousPage();
        } else {
          this.nextPage();
        }
      }
    };
    
    // Hapus event listener lama jika ada
    this.book.removeEventListener('touchstart', handleTouchStart);
    this.book.removeEventListener('touchend', handleTouchEnd);
    
    // Tambahkan event listener baru
    this.book.addEventListener('touchstart', handleTouchStart, { passive: true });
    this.book.addEventListener('touchend', handleTouchEnd);
  }

  toggleFullscreen() {
    if (!document.fullscreenElement) {
      this.appContainer.requestFullscreen();
      document.body.classList.add('fullscreen-mode');
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
        document.body.classList.remove('fullscreen-mode');
      }
    }
  }

  initializeFullscreenChange() {
    document.addEventListener('fullscreenchange', () => {
      if (document.fullscreenElement) {
        document.body.classList.add('fullscreen-mode');
      } else {
        document.body.classList.remove('fullscreen-mode');
      }
    });
  }

  initializeButtons() {
    this.prevBtn.addEventListener('click', () => this.previousPage());
    this.nextBtn.addEventListener('click', () => this.nextPage());
    this.fullscreenBtn.addEventListener('click', () => this.toggleFullscreen());
    
    // Tambahkan event listener untuk tombol TOC
    this.tocBtn.addEventListener('click', () => this.toggleTableOfContents());
    
    // Tambahkan event listener untuk menutup TOC saat klik di luar
    this.tocOverlay.addEventListener('click', (e) => {
      if (e.target === this.tocOverlay) {
        this.toggleTableOfContents();
      }
    });
  }

  initializeTableOfContents() {
    this.tocList.innerHTML = '';
    
    const fragment = document.createDocumentFragment();
    
    this.chapterTitles.forEach(chapter => {
      const item = document.createElement('div');
      item.className = 'toc-item';
      item.textContent = `${chapter.title} (Halaman ${chapter.page})`;
      
      item.addEventListener('click', () => {
        this.goToPage(chapter.page - 1);
        this.toggleTableOfContents();
      });
      
      fragment.appendChild(item);
    });
    
    this.tocList.appendChild(fragment);
  }

  toggleTableOfContents() {
    this.tocOverlay.classList.toggle('active');
  }

  initializeFullscreenControls() {
    document.addEventListener('keydown', (e) => {
      if (document.fullscreenElement) {
        if (e.key === 'ArrowRight' || e.key === 'Right') {
          this.nextPage();
        } else if (e.key === 'ArrowLeft' || e.key === 'Left') {
          this.previousPage();
        } else if (e.key === 'Escape') {
          this.exitFullscreen();
        }
      }
    });

    // Touch events untuk fullscreen
    let touchStartX = 0;
    let touchEndX = 0;
    
    this.book.addEventListener('touchstart', (e) => {
      touchStartX = e.touches[0].clientX;
    }, false);
    
    this.book.addEventListener('touchend', (e) => {
      touchEndX = e.changedTouches[0].clientX;
      
      const swipeDistance = touchEndX - touchStartX;
      
      if (Math.abs(swipeDistance) > 50) { // Minimal swipe 50px
        if (swipeDistance > 0) {
          this.previousPage();
        } else {
          this.nextPage();
        }
      }
    }, false);
  }

  exitFullscreen() {
    if (document.exitFullscreen) {
      document.exitFullscreen();
    }
  }

  goToPage(pageNum) {
    if (pageNum >= 0 && pageNum < this.totalPages) {
      this.currentPage = pageNum;
      this.updatePagePositions();
      this.updateNavigation();
    }
  }

  // Tambahkan fungsi baru untuk menyimpan seluruh gambar
  async cacheAllPages() {
    try {
        // Cek storage estimate terlebih dahulu
        if (navigator.storage && navigator.storage.estimate) {
            const estimate = await navigator.storage.estimate();
            const percentageUsed = (estimate.usage / estimate.quota) * 100;
            
            // Jika penggunaan storage sudah di atas 80%, bersihkan cache lama
            if (percentageUsed > 80) {
                await this.clearOldCache();
            }
        }
        
        // Cek halaman yang belum tersimpan
        const uncachedPages = [];
        for (let i = 0; i < this.totalPages; i++) {
            const pageKey = `page_${i + 1}`;
            try {
                const cachedPage = await this.getFromDB(pageKey);
                if (!cachedPage) {
                    uncachedPages.push(i);
                }
            } catch (error) {
                uncachedPages.push(i);
            }
        }

        if (uncachedPages.length === 0) return;

        const loadingStatus = document.createElement('div');
        loadingStatus.className = 'loading-status';
        loadingStatus.style.cssText = `
            position: fixed;
            bottom: 20px;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(0, 0, 0, 0.8);
            color: white;
            padding: 10px 20px;
            border-radius: 5px;
            z-index: 1000;
        `;
        document.body.appendChild(loadingStatus);
        
        loadingStatus.textContent = `Menyimpan 0/${uncachedPages.length} halaman...`;
        
        let completed = 0;
        const batchSize = 3; // Kurangi ukuran batch untuk mengurangi penggunaan memori
        
        for (let i = 0; i < uncachedPages.length; i += batchSize) {
            const batch = uncachedPages.slice(i, i + batchSize);
            await Promise.all(batch.map(async (pageIndex) => {
                try {
                    const response = await fetch(`scan/${pageIndex + 1}.jpg`);
                    if (!response.ok) throw new Error('Network response was not ok');
                    
                    const blob = await response.blob();
                    const base64data = await this.blobToBase64(blob);
                    
                    try {
                        await this.saveToDB(`page_${pageIndex + 1}`, base64data);
                        completed++;
                        loadingStatus.textContent = `Menyimpan ${completed}/${uncachedPages.length} halaman...`;
                    } catch (saveError) {
                        console.error(`Gagal menyimpan halaman ${pageIndex + 1}:`, saveError);
                    }
                } catch (error) {
                    console.error(`Gagal mengunduh halaman ${pageIndex + 1}:`, error);
                }
            }));
            
            // Tambahkan jeda kecil antara batch
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        loadingStatus.textContent = 'Semua halaman telah tersimpan di cache';
        setTimeout(() => loadingStatus.remove(), 2000);
    } catch (error) {
        console.error('Error dalam cacheAllPages:', error);
    }
  }
}

// Initialize the digital book when the page loads
document.addEventListener('DOMContentLoaded', () => {
  const digitalBook = new DigitalBook();
});