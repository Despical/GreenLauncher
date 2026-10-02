const fs=require('node:fs')
const p='src/renderer/src/ModsPage.tsx';let s=fs.readFileSync(p,'utf8').replaceAll('\r\n','\n')
const replace=(from,to)=>{if(!s.includes(from))throw Error('Missing replacement: '+from.slice(0,90));s=s.replace(from,to)}
replace('ModVersion }','ModVersion, ModProvider }')
replace("import modrinthIcon from '../assets/modrinth-logo.svg'","import modrinthIcon from '../assets/modrinth-logo.svg'\nimport curseforgeIcon from '../assets/curseforge.svg'\nimport technicIcon from '../assets/technic.png'\nimport { AccountDialog } from './AccountControls'")
replace("url.hostname === 'cdn.modrinth.com'","['cdn.modrinth.com', 'media.forgecdn.net', 'mediafilez.forgecdn.net', 'cdn.technicpack.net'].includes(url.hostname)")
replace("useState<'custom' | 'modrinth'>('custom')","useState<'custom' | ModProvider>('custom')")
replace("  const [contentType, setContentType]",`  const [connected, setConnected] = useState(false)
  const [connectionOpen, setConnectionOpen] = useState(false)
  const [apiKey, setApiKey] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [connectionError, setConnectionError] = useState('')
  const [providerCategories, setProviderCategories] = useState<Array<{value:string;label:string}>>([])
  const [reload, setReload] = useState(0)
  const provider: ModProvider = source === 'custom' ? 'modrinth' : source
  const providerName = source === 'curseforge' ? 'CurseForge' : source === 'technic' ? 'Technic' : 'Modrinth'
  useEffect(() => { window.launcher.getProviderStatus().then(value => setConnected(value.curseforge)).catch(() => {}) }, [])
  const [contentType, setContentType]`)
replace("  useEffect(() => { const timer",`  const selectSource = (next: 'custom' | ModProvider) => {
    setSource(next); setCategory('all'); setSort('relevance'); setQuery(''); setSearchText(''); setError('')
    setContentType(next === 'technic' ? 'modpack' : 'mod')
    setGameVersion(next === 'technic' ? 'all' : baseVersion(profile?.versionId))
  }
  useEffect(() => { setProfileId(state.selectedProfileId ?? state.profiles[0]?.id ?? ''); setInstalled([]) }, [state.selectedAccountId])
  useEffect(() => {
    if(source !== 'curseforge' || !connected) { setProviderCategories([]); return }
    let active=true
    window.launcher.getModCategories('curseforge',contentType).then(value=>{if(active)setProviderCategories(value)}).catch(()=>{if(active)setProviderCategories([])})
    return()=>{active=false}
  },[source,contentType,connected])
  const connect = async () => {
    setConnecting(true); setConnectionError('')
    try { const status=await window.launcher.connectCurseForge(apiKey);setConnected(status.curseforge);setApiKey('');setConnectionOpen(false) }
    catch(error){setConnectionError(error instanceof Error?error.message:String(error))}
    finally{setConnecting(false)}
  }
  useEffect(() => { const timer`)
replace("    if (source !== 'modrinth' || !gameVersion) return","    if (source === 'custom' || !gameVersion || (source === 'curseforge' && !connected)) { setHits([]); setSelected(null); setTotal(0); setLoading(false); return }")
replace("setError(''); setLoading(true)","setError(''); setLoading(true); setLoadingMore(false)")
s=s.replaceAll('category, contentType)','category, contentType, provider)')
replace("  }, [source, searchText, gameVersion, loader, sort, category, contentType])","    return () => { if(token === searchToken.current) searchToken.current++ }\n  }, [source, searchText, gameVersion, loader, sort, category, contentType, connected, reload])")
replace('window.launcher.getModProject(selected.projectId), window.launcher.getModVersions(selected.projectId, gameVersion, loader)','window.launcher.getModProject(selected.projectId, provider), window.launcher.getModVersions(selected.projectId, gameVersion, loader, provider)')
replace('}, [selected?.projectId, gameVersion, loader])','}, [selected?.projectId, gameVersion, loader, source])')
replace("source === 'modrinth' && contentType === 'modpack'","source !== 'custom' && contentType === 'modpack'")
replace('window.launcher.installMod(profile.id, versionId)','window.launcher.installMod(profile.id, versionId, provider)')
replace('window.launcher.installModpack(versionId, gameVersion, loader)','window.launcher.installModpack(versionId, gameVersion, loader, provider)')
replace("onClick={() => setSource('custom')}","disabled={installing || installingLoader} onClick={() => selectSource('custom')}")
replace("onClick={() => setSource('modrinth')}><img src={modrinthIcon} alt=\"\" /> Modrinth</button>",`disabled={installing || installingLoader} onClick={() => selectSource('modrinth')}><img src={modrinthIcon} alt="" /> Modrinth</button>
        <button className={source === 'curseforge' ? 'active' : ''} disabled={installing || installingLoader} onClick={() => selectSource('curseforge')}><img src={curseforgeIcon} alt="" /> CurseForge</button>
        <button className={source === 'technic' ? 'active' : ''} disabled={installing || installingLoader} onClick={() => selectSource('technic')}><img src={technicIcon} alt="" /> Technic</button>`)
replace("<strong>Minecraft · {t('Özel')}</strong><small>{t('Önce sürümü, sonra mod yükleyicisini seç.')}</small>","<strong>Minecraft · {source === 'custom' ? t('Özel') : providerName}</strong><small>{source === 'technic' ? t('Paketin oyun sürümü ve yükleyicisi kurulumda otomatik seçilir.') : t('Önce sürümü, sonra mod yükleyicisini seç.')}</small>")
replace("options={releaseVersions.map(item => ({ value: item.id, label: item.id }))}","options={[...(source === 'technic' ? [{value:'all',label:t('Tüm sürümler')}] : []), ...releaseVersions.map(item => ({ value: item.id, label: item.id }))]}")
replace('<div className="mods-field"><span>{t(\'Mod yükleyicisi\')}</span>',"{source !== 'technic' && <div className=\"mods-field\"><span>{t('Mod yükleyicisi')}</span>")
replace("placeholder={t('Mod yükleyicisi')} /></div>","placeholder={t('Mod yükleyicisi')} /></div>}")
replace("<strong>Modrinth</strong>","<strong>{providerName}</strong>")
replace("onClick={() => setSource('modrinth')}>Modrinth’te","onClick={() => selectSource('modrinth')}>Modrinth’te")
replace("{t('Minecraft sürümünü ve mod yükleyicisini seç. Ardından Modrinth kataloğunda bu kuruluma uygun modları keşfet.')}","{t('Minecraft sürümünü ve yükleyicisini seç. Kaynaklardan modları ve mod paketlerini keşfet.')}")
replace("<button role=\"tab\" aria-selected={contentType === 'mod'}", "{source !== 'technic' && <button role=\"tab\" aria-selected={contentType === 'mod'}")
replace("{t('Modlar')}</button><button role=\"tab\"", "{t('Modlar')}</button>}<button role=\"tab\"")
replace("<small>{contentType === 'modpack' ? t('Seçili sürüm ve yükleyiciye uygun mod paketleri')", "<small>{source === 'technic' ? t('Technic mod paketlerini keşfet') : contentType === 'modpack' ? t('Seçili sürüm ve yükleyiciye uygun mod paketleri')")
replace("<div className=\"mods-field\"><span>{t('Kategori')}</span>","{source !== 'technic' && <div className=\"mods-field\"><span>{t('Kategori')}</span>")
replace("options={categories.map(([id, label]) => ({ value: id, label: t(label) }))}","options={source === 'curseforge' ? [{value:'all',label:t('Tüm kategoriler')}, ...providerCategories] : categories.map(([id, label]) => ({ value: id, label: t(label) }))}")
replace("placeholder={t('Tüm kategoriler')} /></div>","placeholder={t('Tüm kategoriler')} /></div>}")
replace("options={sorts.map(item =>", "options={sorts.filter(item => source !== 'technic' || ['relevance','downloads','updated'].includes(item.id)).map(item =>")
replace("setSource('custom'); window.setTimeout(() => setSource('modrinth'), 0)","setReload(value => value + 1)")
replace("<div className=\"mods-browser-body\">",`{source === 'curseforge' && !connected ? <div className="provider-connection-state"><img src={curseforgeIcon} alt="" /><h3>{t('CurseForge bağlantısı')}</h3><p>{t('CurseForge kataloğu için uygulama bağlantısını yapılandır.')}</p><button className="heading-action primary" onClick={()=>setConnectionOpen(true)}>{t('Bağlantıyı yapılandır')}</button></div> : <div className="mods-browser-body">`)
replace("{new Date(selected.updated).toLocaleDateString(language)}","{selected.updated ? new Date(selected.updated).toLocaleDateString(language) : '—'}")
s=s.replaceAll('item.projectId === project.id',"item.projectId === project.id && (item.provider ?? 'modrinth') === provider")
replace("<div className=\"mods-detail-actions\"><button",`<div className="mods-detail-actions">{project.sourceUrl && <button onClick={()=>window.launcher.openExternal(project.sourceUrl!).catch(error=>onNotice(String(error)))}>{t('Proje sayfası')}</button>}<button`)
replace("disabled={!(contentType === 'modpack' || loaderReady) || !versionId || installing}","disabled={!state.selectedAccountId || !(contentType === 'modpack' || loaderReady) || !versionId || installing}")
replace('          </div>\n        </>}','          </div>}\n        </>}')
replace('      </section>\n    </div>\n  </div>',`      </section>
    </div>
    {connectionOpen && <AccountDialog className="provider-connect-dialog" title={t('CurseForge bağlantısı')} description={t('Uygulamaya ait API anahtarını gir. Windows üzerinde şifrelenerek saklanır.')} closeLabel={t('Kapat')} onClose={()=>{setConnectionOpen(false);setApiKey('')}} locked={connecting} icon={<img src={curseforgeIcon} width="25" alt="" />}>
      <label className="provider-key-label">{t('API anahtarı')}<input type="password" autoComplete="off" spellCheck={false} value={apiKey} onChange={event=>setApiKey(event.target.value)} /></label>
      {connectionError && <p className="provider-connect-error" role="alert">{connectionError}</p>}
      <div className="account-dialog-footer"><button className="account-cancel-button" onClick={()=>{setApiKey('');setConnectionOpen(false)}} disabled={connecting}>{t('Vazgeç')}</button><button className="account-create-button" disabled={connecting||!apiKey.trim()} onClick={()=>void connect()}>{connecting?<LoaderCircle size={16} className="spin"/>:null}{t('Bağlan')}</button></div>
    </AccountDialog>}
  </div>`)
fs.writeFileSync(p,s)
