'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import DiamondMark from './DiamondMark'
import styles from '@/app/landing.module.css'

export default function Navigation({ loggedIn = false }: { loggedIn?: boolean }) {
  const [isOpen, setIsOpen] = useState(false)

  // Deshabilitar scroll del body cuando el menú móvil esté abierto
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [isOpen])

  const toggleMenu = () => setIsOpen(!isOpen)
  const closeMenu = () => setIsOpen(false)

  return (
    <header className={styles.siteNav}>
      <div className={`${styles.wrap} ${styles.navRow}`}>
        <a className={styles.brand} href="#top" onClick={closeMenu} aria-label="Inicio">
          <DiamondMark />
          <span>Obra</span>
        </a>

        {/* Links de escritorio */}
        <nav className={styles.navLinks}>
          <div className={styles.navLinksInline}>
            <a className={styles.navLink} href="#como-funciona">Cómo funciona</a>
            <a className={styles.navLink} href="#roles">Roles y permisos</a>
            <a className={styles.navLink} href="#excel">Por qué dejar el Excel</a>
          </div>
          <Link className={styles.navLinkDesktopOnly} href={loggedIn ? '/admin' : '/auth/login'}>
            {loggedIn ? 'Ir al panel' : 'Iniciar sesión'}
          </Link>
          <a className={`${styles.btn} ${styles.btnGold} ${styles.navCta}`} href="https://wa.me/5493794267780?text=Hola%2C%20quiero%20pedir%20una%20demo%20del%20sistema" target="_blank" rel="noopener noreferrer">
            Pedir una demo
          </a>
        </nav>

        {/* Botón de Menú Hamburguesa para Móvil */}
        <button
          className={`${styles.hamburger} ${isOpen ? styles.hamburgerOpen : ''}`}
          onClick={toggleMenu}
          aria-expanded={isOpen}
          aria-label="Abrir menú de navegación"
        >
          <span className={styles.hamburgerLine} />
          <span className={styles.hamburgerLine} />
          <span className={styles.hamburgerLine} />
        </button>
      </div>

      {/* Menú Desplegable Móvil */}
      <div className={`${styles.navLinksMobile} ${isOpen ? styles.navLinksMobileActive : ''}`}>
        <div className={styles.navLinksMobileInner}>
          <a className={styles.navLinkMobileItem} href="#como-funciona" onClick={closeMenu}>
            Cómo funciona
          </a>
          <a className={styles.navLinkMobileItem} href="#roles" onClick={closeMenu}>
            Roles y permisos
          </a>
          <a className={styles.navLinkMobileItem} href="#excel" onClick={closeMenu}>
            Por qué dejar el Excel
          </a>
          <div className={styles.navLinksMobileDivider} />
          <Link className={styles.navLinkMobileItem} href={loggedIn ? '/admin' : '/auth/login'} onClick={closeMenu}>
            {loggedIn ? 'Ir al panel' : 'Iniciar sesión'}
          </Link>
          <a
            className={`${styles.btn} ${styles.btnGold} ${styles.navMobileCta}`}
            href="https://wa.me/5493794267780?text=Hola%2C%20quiero%20pedir%20una%20demo%20del%20sistema"
            target="_blank"
            rel="noopener noreferrer"
            onClick={closeMenu}
          >
            Pedir una demo
          </a>
        </div>
      </div>
    </header>
  )
}
