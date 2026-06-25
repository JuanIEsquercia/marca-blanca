'use client'

import { useState } from 'react'
import type { Amenity } from '@/types/database'

interface Props {
  amenities: Amenity[]
}

export default function AmenitiesSection({ amenities }: Props) {
  const [activeIdx, setActiveIdx] = useState<Record<string, number>>({})

  if (amenities.length === 0) return null

  function getImg(a: Amenity) {
    const imgs = a.amenity_imagenes ?? []
    return imgs.length > 0 ? imgs[activeIdx[a.id] ?? 0] : null
  }

  function nextImg(a: Amenity) {
    const imgs = a.amenity_imagenes ?? []
    if (imgs.length < 2) return
    setActiveIdx(prev => ({ ...prev, [a.id]: ((prev[a.id] ?? 0) + 1) % imgs.length }))
  }

  function prevImg(a: Amenity) {
    const imgs = a.amenity_imagenes ?? []
    if (imgs.length < 2) return
    setActiveIdx(prev => ({ ...prev, [a.id]: ((prev[a.id] ?? 0) - 1 + imgs.length) % imgs.length }))
  }

  return (
    <section className="bg-slate-950 py-24">
      <div className="max-w-7xl mx-auto px-6 lg:px-12">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-8 h-px bg-indigo-400" />
          <span className="text-indigo-400 text-xs font-semibold uppercase tracking-[0.2em]">
            Amenities
          </span>
        </div>
        <h2 className="text-4xl font-bold text-white mb-16">
          Todo lo que necesitás,<br />
          <span className="text-slate-400 font-normal">en el mismo lugar.</span>
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {amenities.map(a => {
            const currentImg = getImg(a)
            const imgs = a.amenity_imagenes ?? []

            return (
              <div key={a.id}
                className="group bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden
                           hover:border-indigo-800 transition-all">
                {/* Carrusel de imágenes */}
                {imgs.length > 0 ? (
                  <div className="relative h-44 overflow-hidden">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={currentImg?.url}
                      alt={currentImg?.alt ?? a.nombre}
                      className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                    {/* Controles carrusel */}
                    {imgs.length > 1 && (
                      <>
                        <button onClick={() => prevImg(a)}
                          className="absolute left-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full
                                     bg-black/50 text-white flex items-center justify-center hover:bg-black/70">
                          ‹
                        </button>
                        <button onClick={() => nextImg(a)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full
                                     bg-black/50 text-white flex items-center justify-center hover:bg-black/70">
                          ›
                        </button>
                        {/* Dots */}
                        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1">
                          {imgs.map((_, i) => (
                            <button key={i} onClick={() => setActiveIdx(prev => ({ ...prev, [a.id]: i }))}
                              className={`w-1.5 h-1.5 rounded-full transition-colors
                                ${(activeIdx[a.id] ?? 0) === i ? 'bg-white' : 'bg-white/40'}`} />
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                ) : null}

                <div className="p-6">
                  <span className="text-3xl mb-4 block">{a.icono ?? '🏢'}</span>
                  <h3 className="text-white font-semibold mb-1">{a.nombre}</h3>
                  {a.descripcion && (
                    <p className="text-slate-500 text-sm">{a.descripcion}</p>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
