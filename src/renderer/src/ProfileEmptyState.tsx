import { ArrowRight, Plus } from 'lucide-react'
import { translate, type Language } from './i18n'
import releaseIcon from '../assets/minecraft-release.png'
import './profile-empty.css'

export function ProfileEmptyState({ language, onCreate }: { language: Language; onCreate: () => void }) {
  const t = (source: string) => translate(language, source)
  return <section className="profile-onboarding" aria-labelledby="profile-empty-title">
    <div className="profile-onboarding-art" aria-hidden="true"><span className="profile-ghost-card first" /><span className="profile-ghost-card second" /><div className="profile-onboarding-icon"><img src={releaseIcon} alt="" draggable={false} /></div><span className="profile-onboarding-plus"><Plus size={16} /></span></div>
    <h3 id="profile-empty-title">{t('İlk macerana bir profil oluştur')}</h3>
    <p>{t('Oyun sürümünü, belleğini ve sana özel ayarları bir arada tut. Yeni dünyalar için yeni profiller oluşturabilirsin.')}</p>
    <button className="profile-onboarding-create" onClick={onCreate}><Plus size={17} />{t('İlk profili oluştur')}<ArrowRight size={16} /></button>
  </section>
}
