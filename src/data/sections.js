import {
  BookOpen, Settings, Users, Keyboard,
  Monitor, Star, Code2, AlertTriangle, Workflow, Zap,
  Rocket, SlidersHorizontal, LayoutDashboard
} from 'lucide-react'

export const sections = [
  { id: 'intro',           titleVi: 'Giới thiệu',              titleEn: 'Introduction',        icon: BookOpen },
  { id: 'standard-mode',   titleVi: 'Standard Mode',           titleEn: 'Standard Mode',       icon: Zap,              badge: 'Mặc định' },
  { id: 'launcher-guide',  titleVi: 'Launcher — Tạo Mission',  titleEn: 'Launcher Guide',      icon: Rocket },
  { id: 'plan-review',     titleVi: 'Plan Review & Tùy chỉnh', titleEn: 'Plan Review',         icon: SlidersHorizontal },
  { id: 'dashboard-guide', titleVi: 'Dashboard & Giám sát',    titleEn: 'Dashboard Guide',     icon: LayoutDashboard },
  { id: 'setup',           titleVi: 'Cài đặt',                 titleEn: 'Setup & Enable',      icon: Settings },
  { id: 'create-team',     titleVi: 'Agent Teams Mode',        titleEn: 'Agent Teams Mode',    icon: Users,            experimental: true },
  { id: 'interaction',     titleVi: 'Tương tác với Team',      titleEn: 'Team Interaction',    icon: Keyboard,         experimental: true },
  { id: 'display',         titleVi: 'Chế độ hiển thị',        titleEn: 'Display Modes',       icon: Monitor },
  { id: 'best',            titleVi: 'Best Practices',          titleEn: 'Best Practices',      icon: Star },
  { id: 'examples',        titleVi: 'Ví dụ thực tế',          titleEn: 'Real-world Examples', icon: Code2 },
  { id: 'how-it-works',    titleVi: 'Flow hoạt động',         titleEn: 'How It Works',        icon: Workflow },
  { id: 'limits',          titleVi: 'Hạn chế & Lưu ý',       titleEn: 'Limitations & Notes', icon: AlertTriangle },
]
