import React, { useState, useEffect } from 'react';
import {
  Plane,
  Package,
  Search,
  MapPin,
  Calendar,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  ExternalLink,
  MessageCircle,
  Plus,
  Clock,
  Sparkles,
  ChevronRight,
  UserCheck,
  Check,
  Send,
  HelpCircle,
  Lock,
  Layers,
  Briefcase
} from 'lucide-react';
import botAvatarIcon from '../assets/images/bot_avatar_icon_1792998997746.jpg';

export interface TripItem {
  id: number;
  userId: number;
  userName: string;
  userHandle: string;
  userRating: number;
  completedTrips: number;
  fromCity: string;
  toCity: string;
  departureDate: string;
  capacity: string;
  reward: string;
  note: string;
  status: string;
}

export interface ParcelItem {
  id: number;
  senderId: number;
  senderName: string;
  senderHandle: string;
  senderRating: number;
  fromCity: string;
  toCity: string;
  deadlineDate: string;
  category: string;
  weight: string;
  description: string;
  budget: number;
  currency: string;
  status: string;
}

export interface DealItem {
  id: number;
  parcelId: number;
  tripId: number;
  senderName: string;
  senderHandle: string;
  travelerName: string;
  travelerHandle: string;
  route: string;
  reward: string;
  category: string;
  status: 'matched' | 'confirmed' | 'in_transit' | 'delivered';
  inspectionDone: boolean;
  createdAt: string;
}

interface ConsumerAppProps {
  onSwitchToInvestor?: () => void;
  isTelegramWebApp: boolean;
}

export const ConsumerApp: React.FC<ConsumerAppProps> = ({
  onSwitchToInvestor,
  isTelegramWebApp
}) => {
  const [activeTab, setActiveTab] = useState<'explore' | 'post' | 'deals' | 'safety'>('explore');
  const [feedType, setFeedType] = useState<'parcels' | 'trips'>('parcels');
  
  // Data state
  const [trips, setTrips] = useState<TripItem[]>([]);
  const [parcels, setParcels] = useState<ParcelItem[]>([]);
  const [deals, setDeals] = useState<DealItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Search filter
  const [searchFrom, setSearchFrom] = useState('');
  const [searchTo, setSearchTo] = useState('');

  // Modals & Interaction
  const [selectedParcel, setSelectedParcel] = useState<ParcelItem | null>(null);
  const [selectedTrip, setSelectedTrip] = useState<TripItem | null>(null);
  const [matchModalOpen, setMatchModalOpen] = useState(false);
  const [matchAgreement, setMatchAgreement] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Post Form State
  const [postType, setPostType] = useState<'parcel' | 'trip'>('parcel');
  const [formFrom, setFormFrom] = useState('Москва');
  const [formTo, setFormTo] = useState('Дубай');
  const [formCategory, setFormCategory] = useState('Документы');
  const [formWeight, setFormWeight] = useState('до 1 кг');
  const [formReward, setFormReward] = useState('3000');
  const [formDate, setFormDate] = useState('30.10.2026');
  const [formDescription, setFormDescription] = useState('');
  const [formSafetyCheck, setFormSafetyCheck] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Telegram User detection
  const tgUser = (window as any).Telegram?.WebApp?.initDataUnsafe?.user;
  const currentUserName = tgUser?.first_name 
    ? `${tgUser.first_name} ${tgUser.last_name || ''}`.trim() 
    : 'Тестовый пользователь';
  const currentUserHandle = tgUser?.username || 'telegram_user';

  // Quick City shortcuts
  const popularCities = ['Все', 'Москва', 'Дубай', 'Стамбул', 'Ташкент', 'Бишкек', 'Ереван'];

  const showToast = (msg: string) => {
    setToastMessage(msg);
    if ((window as any).Telegram?.WebApp?.HapticFeedback) {
      (window as any).Telegram.WebApp.HapticFeedback.notificationOccurred('success');
    }
    setTimeout(() => setToastMessage(null), 3000);
  };

  // Fetch live shared data from backend
  const fetchData = async () => {
    try {
      const [tripsRes, parcelsRes, dealsRes] = await Promise.all([
        fetch('/api/trips').then(r => r.json()).catch(() => ({ trips: [] })),
        fetch('/api/parcels').then(r => r.json()).catch(() => ({ parcels: [] })),
        fetch('/api/deals').then(r => r.json()).catch(() => ({ deals: [] }))
      ]);

      if (tripsRes.trips) setTrips(tripsRes.trips);
      if (parcelsRes.parcels) setParcels(parcelsRes.parcels);
      if (dealsRes.deals) setDeals(dealsRes.deals);
    } catch (e) {
      console.error('Failed to load shared feed:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    // Parse deep-link tab parameter from Telegram bot buttons
    if (typeof window !== 'undefined') {
      const searchParams = new URLSearchParams(window.location.search);
      const tabParam = searchParams.get('tab');
      if (tabParam === 'traveler' || tabParam === 'trip' || tabParam === 'trips') {
        setActiveTab('explore');
        setFeedType('trips');
      } else if (tabParam === 'sender' || tabParam === 'parcel' || tabParam === 'parcels') {
        setActiveTab('explore');
        setFeedType('parcels');
      } else if (tabParam === 'post_trip') {
        setActiveTab('post');
        setPostType('trip');
      } else if (tabParam === 'post_parcel') {
        setActiveTab('post');
        setPostType('parcel');
      } else if (tabParam === 'deals') {
        setActiveTab('deals');
      } else if (tabParam === 'safety' || tabParam === 'rules') {
        setActiveTab('safety');
      }
    }
  }, []);

  // Filter listings
  const filteredParcels = parcels.filter(p => {
    const matchFrom = !searchFrom || p.fromCity.toLowerCase().includes(searchFrom.toLowerCase());
    const matchTo = !searchTo || p.toCity.toLowerCase().includes(searchTo.toLowerCase());
    return matchFrom && matchTo;
  });

  const filteredTrips = trips.filter(t => {
    const matchFrom = !searchFrom || t.fromCity.toLowerCase().includes(searchFrom.toLowerCase());
    const matchTo = !searchTo || t.toCity.toLowerCase().includes(searchTo.toLowerCase());
    return matchFrom && matchTo;
  });

  // Handle Post submission
  const handleSubmitPost = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formSafetyCheck) {
      alert('Пожалуйста, подтвердите согласие на открытый досмотр посылки.');
      return;
    }
    setSubmitting(true);

    try {
      if (postType === 'parcel') {
        const res = await fetch('/api/parcels', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            senderName: currentUserName,
            senderHandle: currentUserHandle,
            fromCity: formFrom,
            toCity: formTo,
            deadlineDate: formDate,
            category: formCategory,
            weight: formWeight,
            description: formDescription || 'Срочная доставка в открытом виде.',
            budget: Number(formReward) || 2500
          })
        });
        const data = await res.json();
        if (data.parcel) {
          setParcels(prev => [data.parcel, ...prev]);
          showToast('🎉 Заявка на посылку успешно опубликована!');
          setActiveTab('explore');
          setFeedType('parcels');
        }
      } else {
        const res = await fetch('/api/trips', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userName: currentUserName,
            userHandle: currentUserHandle,
            fromCity: formFrom,
            toCity: formTo,
            departureDate: formDate,
            capacity: formWeight,
            reward: `${formReward} ₽`,
            note: formDescription || 'Готов взять посылку в открытом виде.'
          })
        });
        const data = await res.json();
        if (data.trip) {
          setTrips(prev => [data.trip, ...prev]);
          showToast('✈️ Ваша поездка добавлена в поиск!');
          setActiveTab('explore');
          setFeedType('trips');
        }
      }
    } catch (err) {
      console.error(err);
      showToast('Ошибка публикации. Проверьте соединение.');
    } finally {
      setSubmitting(false);
    }
  };

  // Create match / deal
  const handleConfirmMatch = async () => {
    if (!matchAgreement) {
      alert('Подтвердите согласие с правилами досмотра.');
      return;
    }

    const targetParcel = selectedParcel;
    const targetTrip = selectedTrip;

    try {
      const dealPayload = {
        parcelId: targetParcel ? targetParcel.id : 999,
        tripId: targetTrip ? targetTrip.id : 999,
        senderName: targetParcel ? targetParcel.senderName : currentUserName,
        senderHandle: targetParcel ? targetParcel.senderHandle : currentUserHandle,
        travelerName: targetTrip ? targetTrip.userName : currentUserName,
        travelerHandle: targetTrip ? targetTrip.userHandle : currentUserHandle,
        route: targetParcel ? `${targetParcel.fromCity} ➔ ${targetParcel.toCity}` : `${targetTrip?.fromCity} ➔ ${targetTrip?.toCity}`,
        reward: targetParcel ? `${targetParcel.budget} ₽` : (targetTrip?.reward || 'По договоренности'),
        category: targetParcel ? targetParcel.category : 'Посылка'
      };

      const res = await fetch('/api/deals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dealPayload)
      });
      const data = await res.json();
      if (data.deal) {
        setDeals(prev => [data.deal, ...prev]);
        setMatchModalOpen(false);
        showToast('🤝 Отклик отправлен! Сделка добавлена в ваши отклики.');
        setActiveTab('deals');
      }
    } catch (err) {
      console.error(err);
      showToast('Ошибка при отправке отклика.');
    }
  };

  return (
    <div className="flex flex-col min-h-screen bg-slate-950 text-slate-100 font-sans antialiased selection:bg-sky-500 selection:text-white">
      {/* Toast notification */}
      {toastMessage && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-emerald-500 text-white px-4 py-2.5 rounded-full shadow-2xl flex items-center gap-2 text-sm font-medium animate-bounce border border-emerald-400">
          <CheckCircle2 className="w-4 h-4" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Top Header */}
      <header className="sticky top-0 z-30 bg-slate-900/90 backdrop-blur-md border-b border-slate-800/80 px-4 py-3">
        <div className="max-w-md mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl overflow-hidden border border-sky-500/30 bg-sky-500/10 flex items-center justify-center shadow-sm">
              <img src={botAvatarIcon} alt="FlyParcel" className="w-full h-full object-cover" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="font-bold text-base tracking-tight text-white flex items-center gap-1">
                  FlyParcel
                  <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block animate-pulse"></span>
                </span>
                <span className="text-[10px] font-semibold bg-sky-500/20 text-sky-400 px-1.5 py-0.5 rounded border border-sky-500/30">
                  P2P
                </span>
              </div>
              <p className="text-[11px] text-slate-400">Доставка через попутчиков</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* User chip */}
            <div className="hidden xs:flex items-center gap-1.5 bg-slate-800/80 border border-slate-700/60 px-2.5 py-1 rounded-full text-xs">
              <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
              <span className="text-slate-300 font-medium truncate max-w-[90px]">
                {tgUser?.first_name || 'Тест'}
              </span>
            </div>

            {/* Investor Suite Switcher (Discreet badge for web/desktop) */}
            {!isTelegramWebApp && onSwitchToInvestor && (
              <button
                onClick={onSwitchToInvestor}
                title="Перейти в стенд инвестора и архитектуры"
                className="flex items-center gap-1 text-[11px] font-semibold text-sky-300 bg-sky-950/80 hover:bg-sky-900 border border-sky-700/50 px-2.5 py-1 rounded-lg transition-all cursor-pointer shadow-sm"
              >
                <Briefcase className="w-3.5 h-3.5 text-sky-400" />
                <span>Стенд инвестора</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main Body */}
      <main className="flex-1 max-w-md w-full mx-auto pb-24 px-4 pt-3">
        {/* ======================= TAB 1: EXPLORE & FEED ======================= */}
        {activeTab === 'explore' && (
          <div className="space-y-3.5">
            {/* Feed Switcher (Parcels vs Trips) */}
            <div className="grid grid-cols-2 p-1 bg-slate-900/90 rounded-2xl border border-slate-800">
              <button
                onClick={() => setFeedType('parcels')}
                className={`flex items-center justify-center gap-2 py-2.5 rounded-xl font-medium text-xs transition-all cursor-pointer ${
                  feedType === 'parcels'
                    ? 'bg-sky-500 text-white shadow-md shadow-sky-500/25 font-semibold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Package className="w-4 h-4" />
                <span>Посылки ({parcels.length})</span>
              </button>
              <button
                onClick={() => setFeedType('trips')}
                className={`flex items-center justify-center gap-2 py-2.5 rounded-xl font-medium text-xs transition-all cursor-pointer ${
                  feedType === 'trips'
                    ? 'bg-sky-500 text-white shadow-md shadow-sky-500/25 font-semibold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Plane className="w-4 h-4" />
                <span>Попутчики ({trips.length})</span>
              </button>
            </div>

            {/* Search inputs */}
            <div className="bg-slate-900/80 p-3 rounded-2xl border border-slate-800/80 space-y-2">
              <div className="flex items-center gap-2 text-xs">
                <div className="flex-1 flex items-center gap-2 bg-slate-950 px-3 py-2 rounded-xl border border-slate-800">
                  <MapPin className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                  <input
                    type="text"
                    value={searchFrom}
                    onChange={e => setSearchFrom(e.target.value)}
                    placeholder="Откуда (город)..."
                    className="w-full bg-transparent text-xs text-white placeholder-slate-500 focus:outline-none"
                  />
                </div>
                <ArrowRight className="w-3.5 h-3.5 text-slate-600 shrink-0" />
                <div className="flex-1 flex items-center gap-2 bg-slate-950 px-3 py-2 rounded-xl border border-slate-800">
                  <MapPin className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <input
                    type="text"
                    value={searchTo}
                    onChange={e => setSearchTo(e.target.value)}
                    placeholder="Куда (город)..."
                    className="w-full bg-transparent text-xs text-white placeholder-slate-500 focus:outline-none"
                  />
                </div>
              </div>

              {/* Quick city filter chips */}
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 pt-1 scrollbar-none text-[11px]">
                {popularCities.map(city => (
                  <button
                    key={city}
                    onClick={() => {
                      if (city === 'Все') {
                        setSearchFrom('');
                        setSearchTo('');
                      } else {
                        setSearchTo(city);
                      }
                    }}
                    className={`px-2.5 py-1 rounded-lg border whitespace-nowrap transition-all cursor-pointer ${
                      (city === 'Все' && !searchFrom && !searchTo) || searchTo === city
                        ? 'bg-sky-500/20 text-sky-300 border-sky-500/40 font-medium'
                        : 'bg-slate-950/60 text-slate-400 border-slate-800 hover:text-slate-200'
                    }`}
                  >
                    {city}
                  </button>
                ))}
              </div>
            </div>

            {/* List of Parcels */}
            {feedType === 'parcels' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between text-xs text-slate-400 px-1">
                  <span>Актуальные посылки</span>
                  <span>Найдено: {filteredParcels.length}</span>
                </div>

                {filteredParcels.length === 0 ? (
                  <div className="text-center py-12 bg-slate-900/40 rounded-2xl border border-dashed border-slate-800 p-6">
                    <Package className="w-10 h-10 text-slate-600 mx-auto mb-2" />
                    <p className="text-sm font-medium text-slate-300">Посылок не найдено</p>
                    <p className="text-xs text-slate-500 mt-1">Попробуйте изменить города в фильтре или создайте заявку первым</p>
                    <button
                      onClick={() => setActiveTab('post')}
                      className="mt-4 px-4 py-2 bg-sky-500 text-white rounded-xl text-xs font-medium cursor-pointer"
                    >
                      + Разместить посылку
                    </button>
                  </div>
                ) : (
                  filteredParcels.map(p => (
                    <div
                      key={p.id}
                      className="bg-slate-900/90 hover:bg-slate-900 p-3.5 rounded-2xl border border-slate-800/90 transition-all hover:border-sky-500/40 space-y-2.5 shadow-sm"
                    >
                      {/* Top route & reward */}
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="font-semibold text-sm text-white">{p.fromCity}</span>
                            <ArrowRight className="w-3.5 h-3.5 text-sky-400" />
                            <span className="font-semibold text-sm text-white">{p.toCity}</span>
                          </div>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-[11px] text-slate-400 flex items-center gap-1">
                              <Calendar className="w-3 h-3 text-slate-500" />
                              До {p.deadlineDate}
                            </span>
                            <span className="text-[10px] bg-slate-800 text-slate-300 px-2 py-0.5 rounded-full border border-slate-700/60 font-medium">
                              {p.category}
                            </span>
                          </div>
                        </div>

                        <div className="text-right">
                          <span className="text-base font-bold text-emerald-400">
                            {p.budget.toLocaleString()} {p.currency}
                          </span>
                          <span className="block text-[10px] text-slate-500 font-medium">{p.weight}</span>
                        </div>
                      </div>

                      {/* Description */}
                      <p className="text-xs text-slate-300 bg-slate-950/60 p-2.5 rounded-xl border border-slate-800/60 leading-relaxed">
                        {p.description}
                      </p>

                      {/* Sender profile & action */}
                      <div className="flex items-center justify-between pt-1">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-full bg-sky-500/20 text-sky-300 text-xs font-bold flex items-center justify-center border border-sky-500/30">
                            {p.senderName.charAt(0)}
                          </div>
                          <div>
                            <div className="flex items-center gap-1">
                              <span className="text-xs font-medium text-slate-300">{p.senderName}</span>
                              <UserCheck className="w-3 h-3 text-emerald-400" />
                            </div>
                            <span className="text-[10px] text-slate-500">@{p.senderHandle} • ⭐ {p.senderRating}</span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          {p.senderHandle && (
                            <a
                              href={`https://t.me/${p.senderHandle}`}
                              target="_blank"
                              rel="noreferrer"
                              className="p-2 bg-slate-800 hover:bg-slate-700 text-sky-400 rounded-xl transition-all cursor-pointer"
                              title="Написать в Telegram"
                            >
                              <MessageCircle className="w-3.5 h-3.5" />
                            </a>
                          )}
                          <button
                            onClick={() => {
                              setSelectedParcel(p);
                              setSelectedTrip(null);
                              setMatchAgreement(false);
                              setMatchModalOpen(true);
                            }}
                            className="px-3 py-1.5 bg-sky-500 hover:bg-sky-400 text-white text-xs font-medium rounded-xl shadow-sm transition-all cursor-pointer flex items-center gap-1"
                          >
                            <span>Взять посылку</span>
                            <ChevronRight className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* List of Trips */}
            {feedType === 'trips' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between text-xs text-slate-400 px-1">
                  <span>Попутчики и рейсы</span>
                  <span>Найдено: {filteredTrips.length}</span>
                </div>

                {filteredTrips.length === 0 ? (
                  <div className="text-center py-12 bg-slate-900/40 rounded-2xl border border-dashed border-slate-800 p-6">
                    <Plane className="w-10 h-10 text-slate-600 mx-auto mb-2" />
                    <p className="text-sm font-medium text-slate-300">Попутчиков не найдено</p>
                    <p className="text-xs text-slate-500 mt-1">Опубликуйте свою поездку, чтобы другие могли передать посылку</p>
                    <button
                      onClick={() => {
                        setPostType('trip');
                        setActiveTab('post');
                      }}
                      className="mt-4 px-4 py-2 bg-sky-500 text-white rounded-xl text-xs font-medium cursor-pointer"
                    >
                      + Я лечу / еду
                    </button>
                  </div>
                ) : (
                  filteredTrips.map(t => (
                    <div
                      key={t.id}
                      className="bg-slate-900/90 hover:bg-slate-900 p-3.5 rounded-2xl border border-slate-800/90 transition-all hover:border-emerald-500/40 space-y-2.5 shadow-sm"
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="font-semibold text-sm text-white">{t.fromCity}</span>
                            <Plane className="w-3.5 h-3.5 text-emerald-400 rotate-45" />
                            <span className="font-semibold text-sm text-white">{t.toCity}</span>
                          </div>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-[11px] text-slate-400 flex items-center gap-1">
                              <Calendar className="w-3 h-3 text-slate-500" />
                              Вылет: {t.departureDate}
                            </span>
                            <span className="text-[10px] bg-emerald-500/10 text-emerald-400 px-2 py-0.5 rounded-full border border-emerald-500/20 font-medium">
                              Свободно: {t.capacity}
                            </span>
                          </div>
                        </div>

                        <div className="text-right">
                          <span className="text-base font-bold text-emerald-400">{t.reward}</span>
                          <span className="block text-[10px] text-slate-500 font-medium">вознаграждение</span>
                        </div>
                      </div>

                      <p className="text-xs text-slate-300 bg-slate-950/60 p-2.5 rounded-xl border border-slate-800/60 leading-relaxed">
                        {t.note}
                      </p>

                      <div className="flex items-center justify-between pt-1">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-full bg-emerald-500/20 text-emerald-300 text-xs font-bold flex items-center justify-center border border-emerald-500/30">
                            {t.userName.charAt(0)}
                          </div>
                          <div>
                            <div className="flex items-center gap-1">
                              <span className="text-xs font-medium text-slate-300">{t.userName}</span>
                              <UserCheck className="w-3 h-3 text-emerald-400" />
                            </div>
                            <span className="text-[10px] text-slate-500">
                              @{t.userHandle} • ⭐ {t.userRating} ({t.completedTrips} доставок)
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          {t.userHandle && (
                            <a
                              href={`https://t.me/${t.userHandle}`}
                              target="_blank"
                              rel="noreferrer"
                              className="p-2 bg-slate-800 hover:bg-slate-700 text-sky-400 rounded-xl transition-all cursor-pointer"
                              title="Написать в Telegram"
                            >
                              <MessageCircle className="w-3.5 h-3.5" />
                            </a>
                          )}
                          <button
                            onClick={() => {
                              setSelectedTrip(t);
                              setSelectedParcel(null);
                              setMatchAgreement(false);
                              setMatchModalOpen(true);
                            }}
                            className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium rounded-xl shadow-sm transition-all cursor-pointer flex items-center gap-1"
                          >
                            <span>Передать попутчику</span>
                            <ChevronRight className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        )}

        {/* ======================= TAB 2: POST WIZARD ======================= */}
        {activeTab === 'post' && (
          <div className="space-y-4">
            <div className="bg-slate-900/80 p-3 rounded-2xl border border-slate-800/80 text-center">
              <h2 className="text-base font-bold text-white">Разместить объявление</h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Заполните форму за 1 минуту. Объявление сразу появится в поиске у всех пользователей.
              </p>
            </div>

            {/* Type selector */}
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setPostType('parcel')}
                className={`p-3 rounded-2xl border text-left transition-all cursor-pointer ${
                  postType === 'parcel'
                    ? 'bg-sky-500/10 border-sky-500 text-white'
                    : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <Package className="w-4 h-4 text-sky-400" />
                  <span className="font-semibold text-xs text-white">Отправить посылку</span>
                </div>
                <p className="text-[11px] text-slate-400">Нужно передать вещи или документы</p>
              </button>

              <button
                type="button"
                onClick={() => setPostType('trip')}
                className={`p-3 rounded-2xl border text-left transition-all cursor-pointer ${
                  postType === 'trip'
                    ? 'bg-emerald-500/10 border-emerald-500 text-white'
                    : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <Plane className="w-4 h-4 text-emerald-400" />
                  <span className="font-semibold text-xs text-white">Я лечу / еду</span>
                </div>
                <p className="text-[11px] text-slate-400">Есть свободное место в багаже</p>
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmitPost} className="bg-slate-900/90 p-4 rounded-2xl border border-slate-800/90 space-y-3.5 shadow-sm">
              {/* Route */}
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[11px] font-medium text-slate-400 mb-1">Город отправления</label>
                  <input
                    type="text"
                    required
                    value={formFrom}
                    onChange={e => setFormFrom(e.target.value)}
                    placeholder="Например: Москва"
                    className="w-full bg-slate-950 border border-slate-800 px-3 py-2 rounded-xl text-xs text-white focus:outline-none focus:border-sky-500"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-400 mb-1">Город назначения</label>
                  <input
                    type="text"
                    required
                    value={formTo}
                    onChange={e => setFormTo(e.target.value)}
                    placeholder="Например: Дубай"
                    className="w-full bg-slate-950 border border-slate-800 px-3 py-2 rounded-xl text-xs text-white focus:outline-none focus:border-sky-500"
                  />
                </div>
              </div>

              {/* Date & Weight */}
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[11px] font-medium text-slate-400 mb-1">
                    {postType === 'parcel' ? 'Крайняя дата доставки' : 'Дата вылета / поездки'}
                  </label>
                  <input
                    type="text"
                    required
                    value={formDate}
                    onChange={e => setFormDate(e.target.value)}
                    placeholder="30.10.2026"
                    className="w-full bg-slate-950 border border-slate-800 px-3 py-2 rounded-xl text-xs text-white focus:outline-none focus:border-sky-500"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-400 mb-1">
                    {postType === 'parcel' ? 'Вес посылки' : 'Свободный вес'}
                  </label>
                  <select
                    value={formWeight}
                    onChange={e => setFormWeight(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 px-3 py-2 rounded-xl text-xs text-white focus:outline-none focus:border-sky-500"
                  >
                    <option value="до 0.5 кг">до 0.5 кг (Документы)</option>
                    <option value="до 1 кг">до 1 кг</option>
                    <option value="до 2.5 кг">до 2.5 кг</option>
                    <option value="до 5 кг">до 5 кг</option>
                    <option value="до 10 кг">до 10 кг</option>
                  </select>
                </div>
              </div>

              {/* Category (for parcel) & Reward */}
              <div className="grid grid-cols-2 gap-2.5">
                {postType === 'parcel' ? (
                  <div>
                    <label className="block text-[11px] font-medium text-slate-400 mb-1">Категория</label>
                    <select
                      value={formCategory}
                      onChange={e => setFormCategory(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 px-3 py-2 rounded-xl text-xs text-white focus:outline-none focus:border-sky-500"
                    >
                      <option value="Документы">Документы</option>
                      <option value="Одежда & Покупки">Одежда & Покупки</option>
                      <option value="Электроника">Электроника</option>
                      <option value="Другое">Другое</option>
                    </select>
                  </div>
                ) : (
                  <div>
                    <label className="block text-[11px] font-medium text-slate-400 mb-1">Тип багажа</label>
                    <input
                      type="text"
                      disabled
                      value="Ручная кладь / Чемодан"
                      className="w-full bg-slate-950/60 border border-slate-800 px-3 py-2 rounded-xl text-xs text-slate-400"
                    />
                  </div>
                )}

                <div>
                  <label className="block text-[11px] font-medium text-slate-400 mb-1">
                    {postType === 'parcel' ? 'Вознаграждение (₽)' : 'Оплата за кг (₽)'}
                  </label>
                  <input
                    type="number"
                    required
                    value={formReward}
                    onChange={e => setFormReward(e.target.value)}
                    placeholder="3000"
                    className="w-full bg-slate-950 border border-slate-800 px-3 py-2 rounded-xl text-xs text-white focus:outline-none focus:border-sky-500"
                  />
                </div>
              </div>

              {/* Description */}
              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">
                  {postType === 'parcel' ? 'Что передаете (описание содержимого)' : 'Примечание к рейсу / где встречаться'}
                </label>
                <textarea
                  rows={2}
                  value={formDescription}
                  onChange={e => setFormDescription(e.target.value)}
                  placeholder={
                    postType === 'parcel'
                      ? 'Опишите содержимое. Важно: коробка должна быть открытой для осмотра.'
                      : 'Номер рейса, аэропорт вылета/прилета, время встречи.'
                  }
                  className="w-full bg-slate-950 border border-slate-800 px-3 py-2 rounded-xl text-xs text-white placeholder-slate-600 focus:outline-none focus:border-sky-500 resize-none"
                />
              </div>

              {/* Strict Safety Inspection Checkbox */}
              <div className="bg-sky-950/40 border border-sky-900/60 p-3 rounded-xl space-y-2">
                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formSafetyCheck}
                    onChange={e => setFormSafetyCheck(e.target.checked)}
                    className="mt-0.5 rounded border-slate-700 text-sky-500 focus:ring-0 cursor-pointer"
                  />
                  <span className="text-[11px] text-slate-300 leading-snug">
                    <strong className="text-white">Правило безопасности:</strong> Я подтверждаю, что посылка будет передана строго в{' '}
                    <span className="text-sky-300 underline underline-offset-2">открытом виде для полного досмотра</span> и не содержит запрещенных правилами авиаперевозок предметов.
                  </span>
                </label>
              </div>

              {/* Submit button */}
              <button
                type="submit"
                disabled={submitting || !formSafetyCheck}
                className="w-full py-3 bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-400 hover:to-blue-500 text-white rounded-xl text-xs font-semibold shadow-lg shadow-sky-500/20 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {submitting ? (
                  <span>Публикация...</span>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Опубликовать заявку</span>
                  </>
                )}
              </button>
            </form>
          </div>
        )}

        {/* ======================= TAB 3: DEALS & MATCHES ======================= */}
        {activeTab === 'deals' && (
          <div className="space-y-3.5">
            <div className="bg-slate-900/80 p-3 rounded-2xl border border-slate-800/80">
              <h2 className="text-base font-bold text-white">Мои сделки и отклики</h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Здесь фиксируются все договорённости между отправителями и попутчиками.
              </p>
            </div>

            {deals.length === 0 ? (
              <div className="text-center py-12 bg-slate-900/40 rounded-2xl border border-dashed border-slate-800 p-6">
                <ShieldCheck className="w-10 h-10 text-slate-600 mx-auto mb-2" />
                <p className="text-sm font-medium text-slate-300">Активных сделок пока нет</p>
                <p className="text-xs text-slate-500 mt-1">Откликнитесь на посылку или рейс в ленте</p>
                <button
                  onClick={() => setActiveTab('explore')}
                  className="mt-4 px-4 py-2 bg-sky-500 text-white rounded-xl text-xs font-medium cursor-pointer"
                >
                  Перейти в ленту
                </button>
              </div>
            ) : (
              deals.map(d => (
                <div
                  key={d.id}
                  className="bg-slate-900/90 p-3.5 rounded-2xl border border-slate-800/90 space-y-3 shadow-sm"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-white flex items-center gap-1.5">
                      <Package className="w-3.5 h-3.5 text-sky-400" />
                      {d.route}
                    </span>
                    <span className="text-[11px] font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full">
                      {d.reward}
                    </span>
                  </div>

                  {/* Status pill */}
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] bg-sky-500/20 text-sky-300 px-2.5 py-1 rounded-lg border border-sky-500/30 font-medium flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {d.status === 'matched' && 'Попутчик найден (ожидает встречи)'}
                      {d.status === 'confirmed' && 'Встреча согласована'}
                      {d.status === 'in_transit' && 'Посылка в пути ✈️'}
                      {d.status === 'delivered' && 'Успешно доставлено ✅'}
                    </span>
                  </div>

                  {/* Participants */}
                  <div className="grid grid-cols-2 gap-2 text-xs bg-slate-950/70 p-2.5 rounded-xl border border-slate-800/60">
                    <div>
                      <span className="text-[10px] text-slate-500 block">Отправитель:</span>
                      <span className="font-medium text-slate-200">{d.senderName}</span>
                      <span className="text-[10px] text-slate-400 block">@{d.senderHandle}</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-500 block">Попутчик:</span>
                      <span className="font-medium text-slate-200">{d.travelerName}</span>
                      <span className="text-[10px] text-slate-400 block">@{d.travelerHandle}</span>
                    </div>
                  </div>

                  {/* Trust Protocol Checklist */}
                  <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800/80 space-y-1.5">
                    <div className="text-[10px] font-semibold text-slate-400 flex items-center gap-1">
                      <ShieldCheck className="w-3 h-3 text-emerald-400" />
                      <span>Памятка перед передачей:</span>
                    </div>
                    <ul className="text-[11px] text-slate-300 space-y-1 list-disc list-inside">
                      <li>Осмотрите посылку лично в открытом виде</li>
                      <li>Сверьте Telegram @username при встрече</li>
                      <li>Оплата передается после проверки содержимого</li>
                    </ul>
                  </div>

                  {/* Telegram Chat action */}
                  <div className="flex items-center gap-2 pt-1">
                    <a
                      href={`https://t.me/${d.travelerHandle || d.senderHandle}`}
                      target="_blank"
                      rel="noreferrer"
                      className="flex-1 py-2 bg-sky-500 hover:bg-sky-400 text-white rounded-xl text-xs font-semibold text-center transition-all cursor-pointer flex items-center justify-center gap-1.5"
                    >
                      <MessageCircle className="w-3.5 h-3.5" />
                      <span>Открыть диалог в Telegram</span>
                    </a>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* ======================= TAB 4: SAFETY & RULES ======================= */}
        {activeTab === 'safety' && (
          <div className="space-y-3.5">
            <div className="bg-slate-900/80 p-4 rounded-2xl border border-slate-800/80 text-center">
              <div className="w-12 h-12 rounded-2xl bg-sky-500/10 border border-sky-500/20 text-sky-400 flex items-center justify-center mx-auto mb-2">
                <ShieldCheck className="w-6 h-6" />
              </div>
              <h2 className="text-base font-bold text-white">Безопасность и правила</h2>
              <p className="text-xs text-slate-400 mt-1">
                FlyParcel объединяет проверенных попутчиков на принципах полной открытости.
              </p>
            </div>

            {/* 4 Golden Rules */}
            <div className="space-y-2.5">
              <div className="bg-slate-900/90 p-3.5 rounded-2xl border border-slate-800 flex items-start gap-3">
                <div className="w-7 h-7 rounded-lg bg-emerald-500/20 text-emerald-300 text-xs font-bold flex items-center justify-center shrink-0 border border-emerald-500/30">
                  1
                </div>
                <div>
                  <h3 className="text-xs font-bold text-white">Обязательный досмотр при встрече</h3>
                  <p className="text-[11px] text-slate-300 mt-0.5 leading-relaxed">
                    Посылки передаются строго в незапечатанном виде. Путешественник обязан лично увидеть каждый предмет внутри.
                  </p>
                </div>
              </div>

              <div className="bg-slate-900/90 p-3.5 rounded-2xl border border-slate-800 flex items-start gap-3">
                <div className="w-7 h-7 rounded-lg bg-rose-500/20 text-rose-300 text-xs font-bold flex items-center justify-center shrink-0 border border-rose-500/30">
                  2
                </div>
                <div>
                  <h3 className="text-xs font-bold text-white">Категорический запрет</h3>
                  <p className="text-[11px] text-slate-300 mt-0.5 leading-relaxed">
                    Строго запрещено: лекарства без рецепта, любые неизвестные порошки/жидкости, скоропортящееся, горючее, оружие.
                  </p>
                </div>
              </div>

              <div className="bg-slate-900/90 p-3.5 rounded-2xl border border-slate-800 flex items-start gap-3">
                <div className="w-7 h-7 rounded-lg bg-sky-500/20 text-sky-300 text-xs font-bold flex items-center justify-center shrink-0 border border-sky-500/30">
                  3
                </div>
                <div>
                  <h3 className="text-xs font-bold text-white">Защита личных данных</h3>
                  <p className="text-[11px] text-slate-300 mt-0.5 leading-relaxed">
                    Никаких открытых номеров телефонов. Вся координация происходит безопасно через официальный Telegram.
                  </p>
                </div>
              </div>

              <div className="bg-slate-900/90 p-3.5 rounded-2xl border border-slate-800 flex items-start gap-3">
                <div className="w-7 h-7 rounded-lg bg-amber-500/20 text-amber-300 text-xs font-bold flex items-center justify-center shrink-0 border border-amber-500/30">
                  4
                </div>
                <div>
                  <h3 className="text-xs font-bold text-white">Честный рейтинг и отзывы</h3>
                  <p className="text-[11px] text-slate-300 mt-0.5 leading-relaxed">
                    Каждая выполненная доставка повышает рейтинг путешественника в системе.
                  </p>
                </div>
              </div>
            </div>

            {/* Support button */}
            <div className="p-3 bg-slate-900/80 rounded-2xl border border-slate-800 text-center">
              <p className="text-xs text-slate-400 mb-2">Остались вопросы или нужна помощь?</p>
              <a
                href="mailto:support@flyparcel.app"
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-xl border border-slate-700 transition-all"
              >
                <HelpCircle className="w-3.5 h-3.5 text-sky-400" />
                <span>Служба поддержки FlyParcel</span>
              </a>
            </div>
          </div>
        )}
      </main>

      {/* ======================= BOTTOM NAVIGATION ======================= */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 bg-slate-950/95 backdrop-blur-md border-t border-slate-800/80 px-2 py-1.5">
        <div className="max-w-md mx-auto grid grid-cols-4 gap-1">
          <button
            onClick={() => setActiveTab('explore')}
            className={`flex flex-col items-center justify-center py-1.5 rounded-xl transition-all cursor-pointer ${
              activeTab === 'explore' ? 'text-sky-400 font-semibold' : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            <Search className="w-5 h-5 mb-0.5" />
            <span className="text-[10px]">Лента</span>
          </button>

          <button
            onClick={() => setActiveTab('post')}
            className={`flex flex-col items-center justify-center py-1.5 rounded-xl transition-all cursor-pointer ${
              activeTab === 'post' ? 'text-sky-400 font-semibold' : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            <div className="w-7 h-7 rounded-full bg-gradient-to-tr from-sky-500 to-blue-600 text-white flex items-center justify-center shadow-md shadow-sky-500/30 -mt-2 mb-0.5">
              <Plus className="w-4 h-4" />
            </div>
            <span className="text-[10px]">Создать</span>
          </button>

          <button
            onClick={() => setActiveTab('deals')}
            className={`flex flex-col items-center justify-center py-1.5 rounded-xl relative transition-all cursor-pointer ${
              activeTab === 'deals' ? 'text-sky-400 font-semibold' : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            {deals.length > 0 && (
              <span className="absolute top-1 right-5 w-4 h-4 rounded-full bg-emerald-500 text-white text-[9px] font-bold flex items-center justify-center">
                {deals.length}
              </span>
            )}
            <Briefcase className="w-5 h-5 mb-0.5" />
            <span className="text-[10px]">Сделки</span>
          </button>

          <button
            onClick={() => setActiveTab('safety')}
            className={`flex flex-col items-center justify-center py-1.5 rounded-xl transition-all cursor-pointer ${
              activeTab === 'safety' ? 'text-sky-400 font-semibold' : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            <ShieldCheck className="w-5 h-5 mb-0.5" />
            <span className="text-[10px]">Правила</span>
          </button>
        </div>
      </nav>

      {/* ======================= MATCH / INSPECTION MODAL ======================= */}
      {matchModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-t-3xl sm:rounded-2xl max-w-md w-full p-5 space-y-4 shadow-2xl animate-in slide-in-from-bottom">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-emerald-400" />
                <h3 className="font-bold text-sm text-white">Подтверждение отклика</h3>
              </div>
              <button
                onClick={() => setMatchModalOpen(false)}
                className="text-slate-500 hover:text-slate-300 text-xs px-2 py-1 rounded cursor-pointer"
              >
                ✕
              </button>
            </div>

            {selectedParcel && (
              <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 space-y-1.5">
                <span className="text-[10px] text-slate-500 uppercase font-semibold">Посылка:</span>
                <div className="font-medium text-xs text-white">
                  {selectedParcel.fromCity} ➔ {selectedParcel.toCity} ({selectedParcel.weight})
                </div>
                <div className="text-xs text-slate-300">{selectedParcel.description}</div>
                <div className="text-xs font-bold text-emerald-400 pt-1">
                  Вознаграждение: {selectedParcel.budget.toLocaleString()} ₽
                </div>
              </div>
            )}

            {selectedTrip && (
              <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 space-y-1.5">
                <span className="text-[10px] text-slate-500 uppercase font-semibold">Рейс попутчика:</span>
                <div className="font-medium text-xs text-white">
                  {selectedTrip.fromCity} ➔ {selectedTrip.toCity} ({selectedTrip.capacity})
                </div>
                <div className="text-xs text-slate-300">Вылет: {selectedTrip.departureDate}</div>
                <div className="text-xs font-bold text-emerald-400 pt-1">
                  Тариф: {selectedTrip.reward}
                </div>
              </div>
            )}

            {/* Checklist */}
            <div className="bg-sky-950/30 border border-sky-900/60 p-3 rounded-xl space-y-2">
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={matchAgreement}
                  onChange={e => setMatchAgreement(e.target.checked)}
                  className="mt-0.5 rounded border-slate-700 text-sky-500 focus:ring-0 cursor-pointer"
                />
                <span className="text-xs text-slate-300 leading-snug">
                  Я согласен лично проверить содержимое перед приёмом в открытом виде и координировать встречу через Telegram.
                </span>
              </label>
            </div>

            {/* Modal Actions */}
            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={() => setMatchModalOpen(false)}
                className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-medium cursor-pointer"
              >
                Отмена
              </button>
              <button
                onClick={handleConfirmMatch}
                disabled={!matchAgreement}
                className="flex-1 py-2.5 bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-400 hover:to-blue-500 text-white rounded-xl text-xs font-semibold shadow-md shadow-sky-500/20 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Подтвердить
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
