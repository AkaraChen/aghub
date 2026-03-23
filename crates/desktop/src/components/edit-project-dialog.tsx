import { useState, useEffect } from "react"
import { useTranslation } from "react-i18next"
import { Button, Label, Modal, TextField, Input } from "@heroui/react"
import { useUpdateProject, useAddProject } from "../hooks/use-projects"
import type { Project } from "../lib/store"

interface EditProjectDialogProps {
  project: Project
  isOpen: boolean
  onClose: () => void
}

export function EditProjectDialog({ project, isOpen, onClose }: EditProjectDialogProps) {
  const { t } = useTranslation()
  const updateProject = useUpdateProject()
  const [name, setName] = useState(project.name)

  useEffect(() => {
    setName(project.name)
  }, [project.name])

  const handleSave = () => {
    if (name.trim()) {
      updateProject.mutate(
        { id: project.id, updates: { name: name.trim() } },
        { onSuccess: onClose }
      )
    }
  }

  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={onClose}>
      <Modal.Container>
        <Modal.Dialog>
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Heading>{t("editProject")}</Modal.Heading>
          </Modal.Header>
          <Modal.Body className="p-6">
            <div className="flex flex-col gap-4">
              <TextField className="w-full">
                <Label>{t("projectName")}</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t("projectName")}
                />
              </TextField>
              <TextField className="w-full">
                <Label>{t("projectPath")}</Label>
                <Input value={project.path} readOnly />
              </TextField>
            </div>
          </Modal.Body>
          <Modal.Footer>
            <Button slot="close" variant="secondary">
              {t("cancel")}
            </Button>
            <Button onPress={handleSave} isDisabled={!name.trim()}>
              {t("save")}
            </Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}

interface CreateProjectDialogProps {
  isOpen: boolean
  onClose: () => void
}

export function CreateProjectDialog({ isOpen, onClose }: CreateProjectDialogProps) {
  const { t } = useTranslation()
  const addProject = useAddProject()
  const [name, setName] = useState("")
  const [path, setPath] = useState("")

  useEffect(() => {
    if (isOpen) {
      setName("")
      setPath("")
    }
  }, [isOpen])

  const handleSave = () => {
    if (name.trim() && path.trim()) {
      addProject.mutate(
        { name: name.trim(), path: path.trim() },
        { onSuccess: onClose }
      )
    }
  }

  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={onClose}>
      <Modal.Container>
        <Modal.Dialog>
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Heading>{t("addProject")}</Modal.Heading>
          </Modal.Header>
          <Modal.Body className="p-6">
            <div className="flex flex-col gap-4">
              <TextField className="w-full">
                <Label>{t("projectName")}</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t("projectName")}
                />
              </TextField>
              <TextField className="w-full">
                <Label>{t("projectPath")}</Label>
                <Input
                  value={path}
                  onChange={(e) => setPath(e.target.value)}
                  placeholder={t("projectPathPlaceholder")}
                />
              </TextField>
            </div>
          </Modal.Body>
          <Modal.Footer>
            <Button slot="close" variant="secondary">
              {t("cancel")}
            </Button>
            <Button onPress={handleSave} isDisabled={!name.trim() || !path.trim()}>
              {t("save")}
            </Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}
