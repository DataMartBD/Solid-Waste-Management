import { useNavigate, useSearchParams } from 'react-router-dom'
import SurveyForm from '../components/SurveyForm.jsx'

// Recording a survey, on its own page.
//
// The questionnaire is seventy-two questions across seven sections. In a dialog
// that meant scrolling a small box inside a page that was already scrolling,
// with the submit buttons pinned out of reach of the question being answered.
// The form itself is unchanged — it still renders whatever the server sends —
// only the frame around it is a page now.

export default function SurveyEntry() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  // Set when the surveyor came at this through the register — "survey that
  // building" rather than "record a survey". Absent is the ordinary case.
  const holdingId = params.get('holding') || null
  const back = () => navigate(holdingId ? '/app/holdings' : '/app/surveys')

  return (
    <SurveyForm
      holdingId={holdingId}
      onClose={back}
      // The list reloads on mount, so landing back on it shows what was just
      // recorded without threading the saved row through the router.
      onSaved={back}
    />
  )
}
