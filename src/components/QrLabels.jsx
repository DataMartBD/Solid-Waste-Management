// QR stickers for holdings, ready to print.
//
// The QR tag exists to be fixed to the building and scanned by the collector,
// so it lives here — printed from the Holdings list, one at a time or a whole
// list on A4 — rather than on the data-entry form. The code carries the same
// payload the collector app scans: SWMS|<holding id>|<tag>.

import { QRCodeSVG } from 'qrcode.react'
import { Modal, ModalActions } from './Modal.jsx'
import { useLang } from '../i18n/index.jsx'

function QrLabel({ holding }) {
  const { t } = useLang()
  return (
    <div className="qr-label">
      <QRCodeSVG value={`SWMS|${holding.id}|${holding.qr}`} size={104} level="M"
        marginSize={0} fgColor="#0b2a1e" bgColor="#ffffff" />
      <div className="qr-label-text">
        <div className="qr-label-tag">{holding.qr}</div>
        <div className="qr-label-line"><b>{t('holdings.col.holdingNo')}:</b> {holding.holdingNo}</div>
        {holding.ownerName && <div className="qr-label-line">{holding.ownerName}</div>}
        <div className="qr-label-line">{[holding.lane, holding.road].filter(Boolean).join(', ')}</div>
        <div className="qr-label-line muted">{holding.ward} · {holding.id}</div>
      </div>
    </div>
  )
}

export function QrPrintModal({ holdings, onClose }) {
  const { t, n } = useLang()
  const printable = holdings.filter((h) => h.qr)
  return (
    <Modal
      title={printable.length === 1 ? t('holdings.qrPrint.one') : t('holdings.qrPrint.many', { count: n(printable.length) })}
      subtitle={t('holdings.qrPrint.subtitle')}
      onClose={onClose}
      width={printable.length === 1 ? 420 : 860}
    >
      {printable.length === 0 ? (
        <div className="muted small">{t('holdings.qrPrint.none')}</div>
      ) : (
        <div className="qr-print">
          {printable.map((h) => <QrLabel key={h.id} holding={h} />)}
        </div>
      )}
      <ModalActions>
        <button type="button" className="btn btn-ghost" onClick={onClose}>{t('common.close')}</button>
        <button type="button" className="btn btn-primary" disabled={printable.length === 0}
          onClick={() => window.print()}>
          {t('holdings.qrPrint.print')}
        </button>
      </ModalActions>
    </Modal>
  )
}
