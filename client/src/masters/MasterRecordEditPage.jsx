import { useParams, useNavigate } from 'react-router-dom'
import MasterForm from './MasterForm'

export default function MasterRecordEditPage() {
  const { slug, id } = useParams()
  const navigate     = useNavigate()

  function handleSave() {
    navigate(`/masters/${slug}/records/${id}`)
  }

  function handleCancel() {
    navigate(`/masters/${slug}/records/${id}`)
  }

  return (
    <div className="page-shell fade-up">
      <MasterForm
        slug={slug}
        recordId={id}
        onSave={handleSave}
        onCancel={handleCancel}
      />
    </div>
  )
}
