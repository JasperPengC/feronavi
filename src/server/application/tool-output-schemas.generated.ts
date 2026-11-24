/** 自动生成：node scripts/generate-tool-output-schemas.mjs。源为实际handler/领域返回类型；不要手工修改。 */
export const generatedToolOutputs: { results: Record<string, Record<string, unknown>>; definitions: Record<string, Record<string, unknown>>; sources: Record<string,string> } = {
  "results": {
    "activity.project": {
      "$ref": "#/$defs/T361"
    },
    "announcement.list": {
      "$ref": "#/$defs/T142"
    },
    "announcement.revoke": {
      "$ref": "#/$defs/T435"
    },
    "announcement.send": {
      "$ref": "#/$defs/T433"
    },
    "approval.approve": {
      "$ref": "#/$defs/T438"
    },
    "approval.list": {
      "$ref": "#/$defs/T379"
    },
    "approval.reject": {
      "$ref": "#/$defs/T438"
    },
    "attachment.download": {
      "$ref": "#/$defs/T136"
    },
    "attachment.get": {
      "$ref": "#/$defs/T137"
    },
    "attachment.remove": {
      "$ref": "#/$defs/T130"
    },
    "automation.createRule": {
      "$ref": "#/$defs/T441"
    },
    "automation.deleteRule": {
      "$ref": "#/$defs/T139"
    },
    "automation.listRules": {
      "$ref": "#/$defs/T381"
    },
    "automation.listRuns": {
      "$ref": "#/$defs/T383"
    },
    "automation.testRule": {
      "$ref": "#/$defs/T140"
    },
    "automation.updateRule": {
      "$ref": "#/$defs/T138"
    },
    "collab.command": {
      "$ref": "#/$defs/T408"
    },
    "collab.inspect": {
      "$ref": "#/$defs/T330"
    },
    "collab.publishPage": {
      "$ref": "#/$defs/T410"
    },
    "collab.update": {
      "$ref": "#/$defs/T409"
    },
    "comment.create": {
      "$ref": "#/$defs/T19"
    },
    "comment.delete": {
      "$ref": "#/$defs/T421"
    },
    "comment.list": {
      "$ref": "#/$defs/T17"
    },
    "comment.update": {
      "$ref": "#/$defs/T420"
    },
    "customField.archive": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "$ref": "#/$defs/T184"
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "customField.create": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "$ref": "#/$defs/T240"
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "customField.definitions": {
      "$ref": "#/$defs/T238"
    },
    "customField.getValues": {
      "$ref": "#/$defs/T20"
    },
    "customField.setValues": {
      "$ref": "#/$defs/T22"
    },
    "customField.update": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "$ref": "#/$defs/T241"
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "dashboard.addWidget": {
      "$ref": "#/$defs/T207"
    },
    "dashboard.create": {
      "$ref": "#/$defs/T204"
    },
    "dashboard.delete": {
      "$ref": "#/$defs/T404"
    },
    "dashboard.deleteWidget": {
      "$ref": "#/$defs/T406"
    },
    "dashboard.get": {
      "$ref": "#/$defs/T202"
    },
    "dashboard.list": {
      "$ref": "#/$defs/T403"
    },
    "dashboard.listWidgets": {
      "$ref": "#/$defs/T405"
    },
    "dashboard.update": {
      "$ref": "#/$defs/T205"
    },
    "dashboard.updateWidget": {
      "$ref": "#/$defs/T208"
    },
    "dashboard.widgetData": {
      "$ref": "#/$defs/T407"
    },
    "dashboard.widgets.create": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "$ref": "#/$defs/T207"
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "dashboard.widgets.data": {
      "anyOf": [
        {
          "type": "null"
        },
        {
          "$ref": "#/$defs/T189"
        },
        {
          "$ref": "#/$defs/T192"
        },
        {
          "$ref": "#/$defs/T209"
        },
        {
          "$ref": "#/$defs/T210"
        },
        {
          "$ref": "#/$defs/T212"
        },
        {
          "$ref": "#/$defs/T215"
        },
        {
          "$ref": "#/$defs/T218"
        }
      ]
    },
    "dashboard.widgets.delete": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "$ref": "#/$defs/T184"
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "dashboard.widgets.list": {
      "$ref": "#/$defs/T206"
    },
    "dashboard.widgets.update": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "$ref": "#/$defs/T208"
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "department.archive": {
      "$ref": "#/$defs/T289"
    },
    "department.create": {
      "$ref": "#/$defs/T95"
    },
    "department.list": {
      "$ref": "#/$defs/T93"
    },
    "department.update": {
      "$ref": "#/$defs/T96"
    },
    "export.projectReport": {
      "$ref": "#/$defs/T56"
    },
    "export.workItems": {
      "$ref": "#/$defs/T55"
    },
    "focus.blocks": {
      "type": "array",
      "items": {
        "$ref": "#/$defs/T173"
      }
    },
    "focus.createBlock": {
      "$ref": "#/$defs/T175"
    },
    "focus.deleteBlock": {
      "$ref": "#/$defs/T396"
    },
    "focus.getBlock": {
      "$ref": "#/$defs/T173"
    },
    "focus.getSession": {
      "$ref": "#/$defs/T174"
    },
    "focus.listBlocks": {
      "$ref": "#/$defs/T395"
    },
    "focus.listSessions": {
      "$ref": "#/$defs/T397"
    },
    "focus.recordSession": {
      "$ref": "#/$defs/T177"
    },
    "focus.sessions": {
      "type": "array",
      "items": {
        "$ref": "#/$defs/T174"
      }
    },
    "focus.today": {
      "$ref": "#/$defs/T179"
    },
    "focus.updateBlock": {
      "$ref": "#/$defs/T176"
    },
    "focus.updateSession": {
      "$ref": "#/$defs/T178"
    },
    "idea.delete": {
      "$ref": "#/$defs/T130"
    },
    "idea.get": {
      "$ref": "#/$defs/T127"
    },
    "idea.list": {
      "$ref": "#/$defs/T125"
    },
    "idea.promote": {
      "$ref": "#/$defs/T424"
    },
    "idea.submit": {
      "$ref": "#/$defs/T422"
    },
    "idea.unvote": {
      "$ref": "#/$defs/T130"
    },
    "idea.update": {
      "$ref": "#/$defs/T129"
    },
    "idea.vote": {
      "$ref": "#/$defs/T423"
    },
    "import.confirm": {
      "$ref": "#/$defs/T162"
    },
    "import.create": {
      "$ref": "#/$defs/T155"
    },
    "import.dryRun": {
      "$ref": "#/$defs/T160"
    },
    "import.get": {
      "$ref": "#/$defs/T157"
    },
    "import.list": {
      "type": "array",
      "items": {
        "$ref": "#/$defs/T156"
      }
    },
    "import.rollback": {
      "$ref": "#/$defs/T163"
    },
    "import.setMapping": {
      "$ref": "#/$defs/T158"
    },
    "import.suggestions": {
      "$ref": "#/$defs/T54"
    },
    "insight.activitySeries": {
      "$ref": "#/$defs/T195"
    },
    "insight.burnDown": {
      "$ref": "#/$defs/T189"
    },
    "insight.burndown": {
      "$ref": "#/$defs/T189"
    },
    "insight.cumulativeFlow": {
      "$ref": "#/$defs/T192"
    },
    "insight.projectActivity": {
      "$ref": "#/$defs/T195"
    },
    "intake.convertSubmission": {
      "anyOf": [
        {
          "$ref": "#/$defs/T152"
        },
        {
          "$ref": "#/$defs/T153"
        }
      ]
    },
    "intake.createForm": {
      "$ref": "#/$defs/T389"
    },
    "intake.deleteForm": {
      "$ref": "#/$defs/T391"
    },
    "intake.getForm": {
      "$ref": "#/$defs/T145"
    },
    "intake.listForms": {
      "$ref": "#/$defs/T388"
    },
    "intake.listSubmissions": {
      "$ref": "#/$defs/T150"
    },
    "intake.rejectSubmission": {
      "$ref": "#/$defs/T392"
    },
    "intake.rotateToken": {
      "$ref": "#/$defs/T390"
    },
    "intake.updateForm": {
      "$ref": "#/$defs/T149"
    },
    "integration.create": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "$ref": "#/$defs/T246"
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "integration.delete": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "$ref": "#/$defs/T247"
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "integration.list": {
      "$ref": "#/$defs/T244"
    },
    "integration.sync": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "$ref": "#/$defs/T249"
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "integration.syncStatus": {
      "$ref": "#/$defs/T248"
    },
    "integration.update": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "$ref": "#/$defs/T246"
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "knowledge.ask": {
      "$ref": "#/$defs/T372"
    },
    "knowledge.search": {
      "$ref": "#/$defs/T370"
    },
    "member.anonymize": {
      "$ref": "#/$defs/T298"
    },
    "member.assignOrganization": {
      "$ref": "#/$defs/T101"
    },
    "member.disable": {
      "$ref": "#/$defs/T298"
    },
    "member.enable": {
      "$ref": "#/$defs/T298"
    },
    "member.get": {
      "$ref": "#/$defs/T293"
    },
    "member.getPermissions": {
      "$ref": "#/$defs/T294"
    },
    "member.list": {
      "$ref": "#/$defs/T185"
    },
    "meta.capabilities": {
      "$ref": "#/$defs/T57"
    },
    "meta.fields": {
      "$ref": "#/$defs/T374"
    },
    "meta.tool": {
      "$ref": "#/$defs/T81"
    },
    "meta.workflow": {
      "$ref": "#/$defs/T363"
    },
    "notification.getPrefs": {
      "$ref": "#/$defs/T141"
    },
    "notification.list": {
      "$ref": "#/$defs/T359"
    },
    "notification.markRead": {
      "anyOf": [
        {
          "type": "object",
          "properties": {
            "ok": {
              "type": "boolean"
            },
            "scope": {
              "const": "one",
              "type": "string"
            },
            "id": {
              "type": "string"
            }
          },
          "required": [
            "ok",
            "scope",
            "id"
          ],
          "additionalProperties": false
        },
        {
          "type": "object",
          "properties": {
            "ok": {
              "type": "boolean"
            },
            "scope": {
              "const": "all",
              "type": "string"
            }
          },
          "required": [
            "ok",
            "scope"
          ],
          "additionalProperties": false
        }
      ]
    },
    "notification.setPrefs": {
      "$ref": "#/$defs/T141"
    },
    "organization.applyTemplate": {
      "$ref": "#/$defs/T102"
    },
    "organization.archiveDepartment": {
      "type": "object",
      "properties": {
        "ok": {
          "type": "boolean"
        }
      },
      "required": [
        "ok"
      ],
      "additionalProperties": false
    },
    "organization.archivePosition": {
      "type": "object",
      "properties": {
        "ok": {
          "type": "boolean"
        }
      },
      "required": [
        "ok"
      ],
      "additionalProperties": false
    },
    "organization.assignMember": {
      "$ref": "#/$defs/T101"
    },
    "organization.createDepartment": {
      "$ref": "#/$defs/T95"
    },
    "organization.createPosition": {
      "$ref": "#/$defs/T99"
    },
    "organization.departments": {
      "$ref": "#/$defs/T93"
    },
    "organization.get": {
      "$ref": "#/$defs/T284"
    },
    "organization.getTemplate": {
      "$ref": "#/$defs/T286"
    },
    "organization.positions": {
      "$ref": "#/$defs/T97"
    },
    "organization.update": {
      "$ref": "#/$defs/T285"
    },
    "organization.updateDepartment": {
      "$ref": "#/$defs/T96"
    },
    "organization.updatePosition": {
      "$ref": "#/$defs/T100"
    },
    "page.create": {
      "$ref": "#/$defs/T425"
    },
    "page.delete": {
      "$ref": "#/$defs/T130"
    },
    "page.get": {
      "$ref": "#/$defs/T369"
    },
    "page.getPermissions": {
      "$ref": "#/$defs/T49"
    },
    "page.getRevision": {
      "$ref": "#/$defs/T48"
    },
    "page.list": {
      "$ref": "#/$defs/T367"
    },
    "page.permissions": {
      "$ref": "#/$defs/T134"
    },
    "page.restore": {
      "$ref": "#/$defs/T132"
    },
    "page.revisions": {
      "$ref": "#/$defs/T131"
    },
    "page.setPermissions": {
      "$ref": "#/$defs/T135"
    },
    "page.update": {
      "$ref": "#/$defs/T410"
    },
    "ping": {
      "$ref": "#/$defs/T329"
    },
    "plan.addMilestoneProgressUpdate": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "$ref": "#/$defs/T283"
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "plan.archiveIteration": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "type": "object",
          "properties": {
            "ok": {
              "type": "boolean"
            }
          },
          "required": [
            "ok"
          ],
          "additionalProperties": false
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "plan.archiveMilestone": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "type": "object",
          "properties": {
            "ok": {
              "type": "boolean"
            }
          },
          "required": [
            "ok"
          ],
          "additionalProperties": false
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "plan.archiveModule": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "type": "object",
          "properties": {
            "ok": {
              "type": "boolean"
            }
          },
          "required": [
            "ok"
          ],
          "additionalProperties": false
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "plan.archiveRelease": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "type": "object",
          "properties": {
            "ok": {
              "type": "boolean"
            }
          },
          "required": [
            "ok"
          ],
          "additionalProperties": false
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "plan.completeIteration": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "$ref": "#/$defs/T261"
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "plan.completeRelease": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "$ref": "#/$defs/T261"
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "plan.createIteration": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "$ref": "#/$defs/T428"
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "plan.createMilestone": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "$ref": "#/$defs/T278"
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "plan.createModule": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "$ref": "#/$defs/T429"
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "plan.createRelease": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "$ref": "#/$defs/T430"
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "plan.deleteMilestoneProgressUpdate": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "$ref": "#/$defs/T265"
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "plan.getIteration": {
      "$ref": "#/$defs/T428"
    },
    "plan.getMilestone": {
      "$ref": "#/$defs/T354"
    },
    "plan.getModule": {
      "$ref": "#/$defs/T429"
    },
    "plan.getRelease": {
      "$ref": "#/$defs/T430"
    },
    "plan.iterationCapacity": {
      "$ref": "#/$defs/T271"
    },
    "plan.listIterations": {
      "$ref": "#/$defs/T355"
    },
    "plan.listMilestones": {
      "$ref": "#/$defs/T352"
    },
    "plan.listModules": {
      "type": "array",
      "items": {
        "$ref": "#/$defs/T270"
      }
    },
    "plan.listReleases": {
      "$ref": "#/$defs/T357"
    },
    "plan.milestoneDetail": {
      "$ref": "#/$defs/T277"
    },
    "plan.milestoneProgressUpdates": {
      "$ref": "#/$defs/T282"
    },
    "plan.setIterationCapacity": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "$ref": "#/$defs/T273"
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "plan.unarchiveIteration": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "type": "object",
          "properties": {
            "ok": {
              "type": "boolean"
            }
          },
          "required": [
            "ok"
          ],
          "additionalProperties": false
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "plan.unarchiveMilestone": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "type": "object",
          "properties": {
            "ok": {
              "type": "boolean"
            }
          },
          "required": [
            "ok"
          ],
          "additionalProperties": false
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "plan.unarchiveModule": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "type": "object",
          "properties": {
            "ok": {
              "type": "boolean"
            }
          },
          "required": [
            "ok"
          ],
          "additionalProperties": false
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "plan.unarchiveRelease": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "type": "object",
          "properties": {
            "ok": {
              "type": "boolean"
            }
          },
          "required": [
            "ok"
          ],
          "additionalProperties": false
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "plan.updateIteration": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "$ref": "#/$defs/T428"
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "plan.updateMilestone": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "$ref": "#/$defs/T278"
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "plan.updateModule": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "$ref": "#/$defs/T429"
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "plan.updateRelease": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "$ref": "#/$defs/T430"
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "portfolio.addProject": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "$ref": "#/$defs/T227"
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "portfolio.create": {
      "$ref": "#/$defs/T225"
    },
    "portfolio.delete": {
      "$ref": "#/$defs/T387"
    },
    "portfolio.get": {
      "$ref": "#/$defs/T223"
    },
    "portfolio.list": {
      "$ref": "#/$defs/T386"
    },
    "portfolio.removeProject": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "$ref": "#/$defs/T228"
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "portfolio.summary": {
      "$ref": "#/$defs/T229"
    },
    "portfolio.update": {
      "$ref": "#/$defs/T226"
    },
    "position.archive": {
      "$ref": "#/$defs/T290"
    },
    "position.create": {
      "$ref": "#/$defs/T99"
    },
    "position.list": {
      "$ref": "#/$defs/T97"
    },
    "position.update": {
      "$ref": "#/$defs/T100"
    },
    "prefs.get": {
      "$ref": "#/$defs/T118"
    },
    "prefs.update": {
      "$ref": "#/$defs/T118"
    },
    "project.archive": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "$ref": "#/$defs/T181"
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "project.context": {
      "type": "object",
      "properties": {
        "projectId": {
          "type": "string"
        },
        "project": {
          "$ref": "#/$defs/T338"
        },
        "members": {
          "anyOf": [
            {
              "$ref": "#/$defs/T344"
            },
            {
              "type": "object",
              "properties": {
                "unavailable": {
                  "type": "boolean",
                  "const": true
                },
                "code": {
                  "type": "string"
                },
                "tool": {
                  "type": "string"
                }
              },
              "required": [
                "unavailable",
                "code",
                "tool"
              ],
              "additionalProperties": false
            }
          ]
        },
        "workflows": {
          "anyOf": [
            {
              "$ref": "#/$defs/T363"
            },
            {
              "type": "object",
              "properties": {
                "unavailable": {
                  "type": "boolean",
                  "const": true
                },
                "code": {
                  "type": "string"
                },
                "tool": {
                  "type": "string"
                }
              },
              "required": [
                "unavailable",
                "code",
                "tool"
              ],
              "additionalProperties": false
            }
          ]
        },
        "fields": {
          "anyOf": [
            {
              "$ref": "#/$defs/T374"
            },
            {
              "type": "object",
              "properties": {
                "unavailable": {
                  "type": "boolean",
                  "const": true
                },
                "code": {
                  "type": "string"
                },
                "tool": {
                  "type": "string"
                }
              },
              "required": [
                "unavailable",
                "code",
                "tool"
              ],
              "additionalProperties": false
            }
          ]
        },
        "customFields": {
          "anyOf": [
            {
              "$ref": "#/$defs/T238"
            },
            {
              "type": "object",
              "properties": {
                "unavailable": {
                  "type": "boolean",
                  "const": true
                },
                "code": {
                  "type": "string"
                },
                "tool": {
                  "type": "string"
                }
              },
              "required": [
                "unavailable",
                "code",
                "tool"
              ],
              "additionalProperties": false
            }
          ]
        },
        "iterations": {
          "anyOf": [
            {
              "$ref": "#/$defs/T355"
            },
            {
              "type": "object",
              "properties": {
                "unavailable": {
                  "type": "boolean",
                  "const": true
                },
                "code": {
                  "type": "string"
                },
                "tool": {
                  "type": "string"
                }
              },
              "required": [
                "unavailable",
                "code",
                "tool"
              ],
              "additionalProperties": false
            }
          ]
        },
        "milestones": {
          "anyOf": [
            {
              "$ref": "#/$defs/T352"
            },
            {
              "type": "object",
              "properties": {
                "unavailable": {
                  "type": "boolean",
                  "const": true
                },
                "code": {
                  "type": "string"
                },
                "tool": {
                  "type": "string"
                }
              },
              "required": [
                "unavailable",
                "code",
                "tool"
              ],
              "additionalProperties": false
            }
          ]
        },
        "releases": {
          "anyOf": [
            {
              "$ref": "#/$defs/T357"
            },
            {
              "type": "object",
              "properties": {
                "unavailable": {
                  "type": "boolean",
                  "const": true
                },
                "code": {
                  "type": "string"
                },
                "tool": {
                  "type": "string"
                }
              },
              "required": [
                "unavailable",
                "code",
                "tool"
              ],
              "additionalProperties": false
            }
          ]
        },
        "modules": {
          "anyOf": [
            {
              "type": "array",
              "items": {
                "$ref": "#/$defs/T270"
              }
            },
            {
              "type": "object",
              "properties": {
                "unavailable": {
                  "type": "boolean",
                  "const": true
                },
                "code": {
                  "type": "string"
                },
                "tool": {
                  "type": "string"
                }
              },
              "required": [
                "unavailable",
                "code",
                "tool"
              ],
              "additionalProperties": false
            }
          ]
        },
        "workItems": {
          "anyOf": [
            {
              "$ref": "#/$defs/T346"
            },
            {
              "type": "object",
              "properties": {
                "unavailable": {
                  "type": "boolean",
                  "const": true
                },
                "code": {
                  "type": "string"
                },
                "tool": {
                  "type": "string"
                }
              },
              "required": [
                "unavailable",
                "code",
                "tool"
              ],
              "additionalProperties": false
            }
          ]
        }
      },
      "required": [
        "projectId",
        "project",
        "members",
        "workflows",
        "fields",
        "customFields",
        "iterations",
        "milestones",
        "releases",
        "modules",
        "workItems"
      ],
      "additionalProperties": false
    },
    "project.create": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "$ref": "#/$defs/T29"
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "project.createFromTemplate": {
      "$ref": "#/$defs/T28"
    },
    "project.exportCsv": {
      "$ref": "#/$defs/T243"
    },
    "project.get": {
      "$ref": "#/$defs/T338"
    },
    "project.list": {
      "type": "object",
      "properties": {
        "items": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "id": {
                "type": "string"
              },
              "key": {
                "type": "string"
              },
              "name": {
                "type": "string"
              },
              "status": {
                "anyOf": [
                  {
                    "type": "object",
                    "properties": {
                      "key": {
                        "type": "string"
                      },
                      "name": {
                        "type": "string"
                      },
                      "category": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "key",
                      "name",
                      "category"
                    ],
                    "additionalProperties": false
                  },
                  {
                    "type": "null"
                  }
                ]
              },
              "workItemCount": {
                "type": "integer"
              }
            },
            "required": [
              "id",
              "key",
              "name",
              "status",
              "workItemCount"
            ],
            "additionalProperties": false
          }
        },
        "total": {
          "type": "integer"
        }
      },
      "required": [
        "items",
        "total"
      ],
      "additionalProperties": false
    },
    "project.member.add": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "$ref": "#/$defs/T183"
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "project.member.remove": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "$ref": "#/$defs/T184"
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "project.members": {
      "$ref": "#/$defs/T344"
    },
    "project.report": {
      "$ref": "#/$defs/T242"
    },
    "project.status": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "$ref": "#/$defs/T182"
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "project.unarchive": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "$ref": "#/$defs/T181"
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "project.update": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "$ref": "#/$defs/T180"
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "projectTemplate.create": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "$ref": "#/$defs/T25"
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "projectTemplate.createProject": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "$ref": "#/$defs/T28"
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "projectTemplate.delete": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "$ref": "#/$defs/T184"
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "projectTemplate.get": {
      "$ref": "#/$defs/T24"
    },
    "projectTemplate.list": {
      "$ref": "#/$defs/T188"
    },
    "projectTemplate.update": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "$ref": "#/$defs/T26"
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "rag.chat": {
      "$ref": "#/$defs/T308"
    },
    "rag.conversation.action": {
      "$ref": "#/$defs/T304"
    },
    "rag.conversation.cancel": {
      "$ref": "#/$defs/T304"
    },
    "rag.conversation.create": {
      "$ref": "#/$defs/T305"
    },
    "rag.conversation.get": {
      "$ref": "#/$defs/T324"
    },
    "rag.conversation.list": {
      "$ref": "#/$defs/T323"
    },
    "rag.conversation.send": {
      "$ref": "#/$defs/T304"
    },
    "rag.conversation.update": {
      "$ref": "#/$defs/T305"
    },
    "rag.projects": {
      "$ref": "#/$defs/T325"
    },
    "rag.search": {
      "$ref": "#/$defs/T327"
    },
    "role.assign": {
      "$ref": "#/$defs/T92"
    },
    "role.assignments": {
      "type": "array",
      "items": {
        "$ref": "#/$defs/T92"
      }
    },
    "role.create": {
      "$ref": "#/$defs/T84"
    },
    "role.createAssignment": {
      "$ref": "#/$defs/T92"
    },
    "role.delete": {
      "$ref": "#/$defs/T301"
    },
    "role.deleteAssignment": {
      "$ref": "#/$defs/T303"
    },
    "role.getAssignment": {
      "$ref": "#/$defs/T92"
    },
    "role.list": {
      "$ref": "#/$defs/T299"
    },
    "role.listAssignments": {
      "$ref": "#/$defs/T302"
    },
    "role.listPermissions": {
      "$ref": "#/$defs/T300"
    },
    "role.listScopes": {
      "anyOf": [
        {
          "$ref": "#/$defs/T86"
        },
        {
          "$ref": "#/$defs/T88"
        },
        {
          "$ref": "#/$defs/T90"
        }
      ]
    },
    "role.permissions": {
      "type": "array",
      "items": {
        "$ref": "#/$defs/T82"
      }
    },
    "role.revoke": {
      "$ref": "#/$defs/T85"
    },
    "role.scopeOptions": {
      "anyOf": [
        {
          "$ref": "#/$defs/T86"
        },
        {
          "$ref": "#/$defs/T88"
        },
        {
          "$ref": "#/$defs/T90"
        }
      ]
    },
    "role.update": {
      "$ref": "#/$defs/T84"
    },
    "role.updateAssignment": {
      "$ref": "#/$defs/T92"
    },
    "savedView.create": {
      "$ref": "#/$defs/T399"
    },
    "savedView.delete": {
      "$ref": "#/$defs/T401"
    },
    "savedView.get": {
      "$ref": "#/$defs/T275"
    },
    "savedView.list": {
      "$ref": "#/$defs/T398"
    },
    "savedView.reorder": {
      "$ref": "#/$defs/T402"
    },
    "savedView.update": {
      "$ref": "#/$defs/T400"
    },
    "sla.createPolicy": {
      "$ref": "#/$defs/T121"
    },
    "sla.deletePolicy": {
      "$ref": "#/$defs/T124"
    },
    "sla.get": {
      "$ref": "#/$defs/T377"
    },
    "sla.listPolicies": {
      "$ref": "#/$defs/T119"
    },
    "sla.pause": {
      "$ref": "#/$defs/T436"
    },
    "sla.resume": {
      "$ref": "#/$defs/T436"
    },
    "sla.updatePolicy": {
      "$ref": "#/$defs/T123"
    },
    "team.create": {
      "$ref": "#/$defs/T106"
    },
    "team.delete": {
      "$ref": "#/$defs/T292"
    },
    "team.list": {
      "$ref": "#/$defs/T291"
    },
    "team.members": {
      "$ref": "#/$defs/T104"
    },
    "team.update": {
      "$ref": "#/$defs/T107"
    },
    "timeLog.create": {
      "$ref": "#/$defs/T113"
    },
    "timeLog.delete": {
      "$ref": "#/$defs/T85"
    },
    "timeLog.list": {
      "$ref": "#/$defs/T111"
    },
    "timeLog.update": {
      "$ref": "#/$defs/T108"
    },
    "todo.create": {
      "$ref": "#/$defs/T171"
    },
    "todo.delete": {
      "$ref": "#/$defs/T394"
    },
    "todo.list": {
      "$ref": "#/$defs/T393"
    },
    "todo.update": {
      "$ref": "#/$defs/T172"
    },
    "webhook.create": {
      "$ref": "#/$defs/T254"
    },
    "webhook.delete": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "$ref": "#/$defs/T257"
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "webhook.deliveries": {
      "$ref": "#/$defs/T258"
    },
    "webhook.list": {
      "$ref": "#/$defs/T252"
    },
    "webhook.replay": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "$ref": "#/$defs/T260"
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "webhook.update": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "$ref": "#/$defs/T256"
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "whoami": {
      "$ref": "#/$defs/T332"
    },
    "workbench.get": {
      "$ref": "#/$defs/T164"
    },
    "workflow.addState": {
      "$ref": "#/$defs/T38"
    },
    "workflow.addTransition": {
      "$ref": "#/$defs/T43"
    },
    "workflow.archiveState": {
      "$ref": "#/$defs/T85"
    },
    "workflow.create": {
      "$ref": "#/$defs/T34"
    },
    "workflow.list": {
      "type": "array",
      "items": {
        "$ref": "#/$defs/T33"
      }
    },
    "workflow.listStates": {
      "$ref": "#/$defs/T36"
    },
    "workflow.listTransitions": {
      "$ref": "#/$defs/T41"
    },
    "workflow.removeTransition": {
      "$ref": "#/$defs/T85"
    },
    "workflow.states": {
      "type": "array",
      "items": {
        "$ref": "#/$defs/T37"
      }
    },
    "workflow.transitions": {
      "type": "array",
      "items": {
        "$ref": "#/$defs/T42"
      }
    },
    "workflow.update": {
      "$ref": "#/$defs/T35"
    },
    "workflow.updateState": {
      "$ref": "#/$defs/T39"
    },
    "workflow.updateTransition": {
      "$ref": "#/$defs/T44"
    },
    "workitem.addCollaborator": {
      "$ref": "#/$defs/T11"
    },
    "workitem.addProgress": {
      "$ref": "#/$defs/T4"
    },
    "workitem.addProgressUpdate": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "$ref": "#/$defs/T4"
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "workitem.assign": {
      "$ref": "#/$defs/T417"
    },
    "workitem.children": {
      "$ref": "#/$defs/T262"
    },
    "workitem.collaborators": {
      "$ref": "#/$defs/T109"
    },
    "workitem.comment": {
      "$ref": "#/$defs/T418"
    },
    "workitem.comments": {
      "$ref": "#/$defs/T351"
    },
    "workitem.contentLinks": {
      "$ref": "#/$defs/T114"
    },
    "workitem.create": {
      "$ref": "#/$defs/T416"
    },
    "workitem.createContentLink": {
      "$ref": "#/$defs/T117"
    },
    "workitem.delete": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "$ref": "#/$defs/T265"
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "workitem.deleteContentLink": {
      "$ref": "#/$defs/T85"
    },
    "workitem.deleteProgress": {
      "$ref": "#/$defs/T5"
    },
    "workitem.deleteProgressUpdate": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "$ref": "#/$defs/T265"
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "workitem.follow": {
      "$ref": "#/$defs/T85"
    },
    "workitem.get": {
      "$ref": "#/$defs/T348"
    },
    "workitem.link": {
      "$ref": "#/$defs/T419"
    },
    "workitem.list": {
      "$ref": "#/$defs/T346"
    },
    "workitem.listCollaborators": {
      "$ref": "#/$defs/T9"
    },
    "workitem.listProgress": {
      "$ref": "#/$defs/T2"
    },
    "workitem.listTransfers": {
      "$ref": "#/$defs/T6"
    },
    "workitem.listWatchers": {
      "$ref": "#/$defs/T13"
    },
    "workitem.progressUpdates": {
      "$ref": "#/$defs/T276"
    },
    "workitem.relations": {
      "$ref": "#/$defs/T266"
    },
    "workitem.removeCollaborator": {
      "$ref": "#/$defs/T85"
    },
    "workitem.transfer": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "$ref": "#/$defs/T8"
            }
          ]
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "workitem.transfers": {
      "type": "array",
      "items": {
        "$ref": "#/$defs/T7"
      }
    },
    "workitem.transition": {
      "$ref": "#/$defs/T8"
    },
    "workitem.unfollow": {
      "$ref": "#/$defs/T85"
    },
    "workitem.unlink": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "$ref": "#/$defs/T265"
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "workitem.update": {
      "anyOf": [
        {
          "type": "null"
        },
        {
          "$ref": "#/$defs/T8"
        }
      ]
    },
    "workitem.watchers": {
      "$ref": "#/$defs/T110"
    }
  },
  "definitions": {
    "JsonValue": {
      "anyOf": [
        {
          "type": "null"
        },
        {
          "type": "boolean"
        },
        {
          "type": "number"
        },
        {
          "type": "string"
        },
        {
          "type": "array",
          "items": {
            "$ref": "#/$defs/JsonValue"
          }
        },
        {
          "type": "object",
          "additionalProperties": {
            "$ref": "#/$defs/JsonValue"
          }
        }
      ]
    },
    "T1": {
      "type": "object",
      "properties": {
        "ok": {
          "type": "boolean"
        }
      },
      "required": [
        "ok"
      ],
      "additionalProperties": false
    },
    "T2": {
      "type": "object",
      "properties": {
        "updates": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T3"
          }
        }
      },
      "required": [
        "updates"
      ],
      "additionalProperties": false
    },
    "T3": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "summary": {
          "type": "string"
        },
        "nextSteps": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "blockers": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "authorId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "authorName": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        }
      },
      "required": [
        "id",
        "summary",
        "nextSteps",
        "blockers",
        "createdAt",
        "authorId",
        "authorName"
      ],
      "additionalProperties": false
    },
    "T4": {
      "type": "object",
      "properties": {
        "projectId": {
          "type": "string"
        },
        "workItemId": {
          "type": "string"
        },
        "id": {
          "type": "string"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "authorId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "summary": {
          "type": "string"
        },
        "nextSteps": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "blockers": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        }
      },
      "required": [
        "projectId",
        "workItemId",
        "id",
        "createdAt",
        "authorId",
        "summary",
        "nextSteps",
        "blockers"
      ],
      "additionalProperties": false
    },
    "T5": {
      "type": "object",
      "properties": {
        "ok": {
          "type": "boolean"
        }
      },
      "required": [
        "ok"
      ],
      "additionalProperties": false
    },
    "T6": {
      "type": "object",
      "properties": {
        "transfers": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T7"
          }
        }
      },
      "required": [
        "transfers"
      ],
      "additionalProperties": false
    },
    "T7": {
      "type": "object",
      "properties": {
        "fromName": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "toName": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "actorName": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "id": {
          "type": "string"
        },
        "fromAssigneeId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "toAssigneeId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "actorId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "reason": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "fromName",
        "toName",
        "actorName",
        "id",
        "fromAssigneeId",
        "toAssigneeId",
        "actorId",
        "reason",
        "createdAt"
      ],
      "additionalProperties": false
    },
    "T8": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "projectId": {
          "type": "string"
        },
        "number": {
          "type": "integer"
        },
        "key": {
          "type": "string"
        },
        "type": {
          "type": "string"
        },
        "title": {
          "type": "string"
        },
        "description": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "workflowId": {
          "type": "string"
        },
        "statusId": {
          "type": "string"
        },
        "parentId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "milestoneId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "iterationId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "releaseId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "moduleId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "assigneeId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "reporterId": {
          "type": "string"
        },
        "priority": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "severity": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "estimatePoints": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "estimateHours": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "startDate": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
            }
          ]
        },
        "dueDate": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
            }
          ]
        },
        "completedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "version": {
          "type": "integer"
        },
        "deletedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "updatedAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "projectId",
        "number",
        "key",
        "type",
        "title",
        "description",
        "workflowId",
        "statusId",
        "parentId",
        "milestoneId",
        "iterationId",
        "releaseId",
        "moduleId",
        "assigneeId",
        "reporterId",
        "priority",
        "severity",
        "estimatePoints",
        "estimateHours",
        "startDate",
        "dueDate",
        "completedAt",
        "version",
        "deletedAt",
        "createdAt",
        "updatedAt"
      ],
      "additionalProperties": false
    },
    "T9": {
      "type": "object",
      "properties": {
        "collaborators": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T10"
          }
        }
      },
      "required": [
        "collaborators"
      ],
      "additionalProperties": false
    },
    "T10": {
      "type": "object",
      "properties": {
        "memberId": {
          "type": "string"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "memberId",
        "createdAt"
      ],
      "additionalProperties": false
    },
    "T11": {
      "type": "object",
      "properties": {
        "workItemId": {
          "type": "string"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "memberId": {
          "type": "string"
        }
      },
      "required": [
        "workItemId",
        "createdAt",
        "memberId"
      ],
      "additionalProperties": false
    },
    "T12": {
      "type": "object",
      "properties": {
        "ok": {
          "type": "boolean"
        }
      },
      "required": [
        "ok"
      ],
      "additionalProperties": false
    },
    "T13": {
      "type": "object",
      "properties": {
        "watchers": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T14"
          }
        }
      },
      "required": [
        "watchers"
      ],
      "additionalProperties": false
    },
    "T14": {
      "type": "object",
      "properties": {
        "memberId": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "username": {
          "type": "string"
        },
        "channels": {
          "type": "array",
          "items": {
            "type": "string"
          }
        }
      },
      "required": [
        "memberId",
        "name",
        "username",
        "channels"
      ],
      "additionalProperties": false
    },
    "T15": {
      "type": "object",
      "properties": {
        "ok": {
          "type": "boolean"
        }
      },
      "required": [
        "ok"
      ],
      "additionalProperties": false
    },
    "T16": {
      "type": "object",
      "properties": {
        "ok": {
          "type": "boolean"
        }
      },
      "required": [
        "ok"
      ],
      "additionalProperties": false
    },
    "T17": {
      "type": "object",
      "properties": {
        "comments": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T18"
          }
        }
      },
      "required": [
        "comments"
      ],
      "additionalProperties": false
    },
    "T18": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "targetType": {
          "type": "string"
        },
        "targetId": {
          "type": "string"
        },
        "authorId": {
          "type": "string"
        },
        "body": {
          "type": "string"
        },
        "parentId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "editedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "deletedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "updatedAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "targetType",
        "targetId",
        "authorId",
        "body",
        "parentId",
        "editedAt",
        "deletedAt",
        "createdAt",
        "updatedAt"
      ],
      "additionalProperties": false
    },
    "T19": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "updatedAt": {
          "type": "string",
          "format": "date-time"
        },
        "parentId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "deletedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "targetType": {
          "type": "string"
        },
        "targetId": {
          "type": "string"
        },
        "authorId": {
          "type": "string"
        },
        "body": {
          "type": "string"
        },
        "editedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        }
      },
      "required": [
        "id",
        "createdAt",
        "updatedAt",
        "parentId",
        "deletedAt",
        "targetType",
        "targetId",
        "authorId",
        "body",
        "editedAt"
      ],
      "additionalProperties": false
    },
    "T20": {
      "type": "object",
      "properties": {
        "values": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T21"
          }
        }
      },
      "required": [
        "values"
      ],
      "additionalProperties": false
    },
    "T21": {
      "type": "object",
      "properties": {
        "defId": {
          "type": "string"
        },
        "key": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "type": {
          "type": "string"
        },
        "archived": {
          "type": "boolean"
        },
        "value": {
          "$ref": "#/$defs/JsonValue"
        }
      },
      "required": [
        "defId",
        "key",
        "name",
        "type",
        "archived",
        "value"
      ],
      "additionalProperties": false
    },
    "T22": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T21"
          }
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "T23": {
      "type": "object",
      "properties": {
        "templates": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T24"
          }
        }
      },
      "required": [
        "templates"
      ],
      "additionalProperties": false
    },
    "T24": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "isBuiltin": {
          "type": "boolean"
        },
        "payload": {
          "$ref": "#/$defs/JsonValue"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "name",
        "isBuiltin",
        "payload",
        "createdAt"
      ],
      "additionalProperties": false
    },
    "T25": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "isBuiltin": {
          "type": "boolean"
        },
        "payload": {
          "$ref": "#/$defs/JsonValue"
        }
      },
      "required": [
        "id",
        "name",
        "createdAt",
        "isBuiltin",
        "payload"
      ],
      "additionalProperties": false
    },
    "T26": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "isBuiltin": {
          "type": "boolean"
        },
        "payload": {
          "$ref": "#/$defs/JsonValue"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "name",
        "isBuiltin",
        "payload",
        "createdAt"
      ],
      "additionalProperties": false
    },
    "T27": {
      "type": "object",
      "properties": {
        "ok": {
          "type": "boolean"
        }
      },
      "required": [
        "ok"
      ],
      "additionalProperties": false
    },
    "T28": {
      "type": "object",
      "properties": {
        "project": {
          "$ref": "#/$defs/T29"
        },
        "applied": {
          "$ref": "#/$defs/T30"
        },
        "failures": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T31"
          }
        }
      },
      "required": [
        "project",
        "applied",
        "failures"
      ],
      "additionalProperties": false
    },
    "T29": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "key": {
          "type": "string"
        }
      },
      "required": [
        "id",
        "key"
      ],
      "additionalProperties": false
    },
    "T30": {
      "type": "object",
      "properties": {
        "milestones": {
          "type": "number"
        },
        "iterations": {
          "type": "number"
        },
        "workItems": {
          "type": "number"
        }
      },
      "required": [
        "milestones",
        "iterations",
        "workItems"
      ],
      "additionalProperties": false
    },
    "T31": {
      "type": "object",
      "properties": {
        "kind": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "error": {
          "type": "string"
        }
      },
      "required": [
        "kind",
        "name",
        "error"
      ],
      "additionalProperties": false
    },
    "T32": {
      "type": "object",
      "properties": {
        "workflows": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T33"
          }
        }
      },
      "required": [
        "workflows"
      ],
      "additionalProperties": false
    },
    "T33": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "projectId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "name": {
          "type": "string"
        },
        "appliesToType": {
          "type": "string"
        },
        "isDefault": {
          "type": "boolean"
        },
        "isBuiltin": {
          "type": "boolean"
        }
      },
      "required": [
        "id",
        "projectId",
        "name",
        "appliesToType",
        "isDefault",
        "isBuiltin"
      ],
      "additionalProperties": false
    },
    "T34": {
      "type": "object",
      "properties": {
        "projectId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "id": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "isBuiltin": {
          "type": "boolean"
        },
        "appliesToType": {
          "type": "string"
        },
        "isDefault": {
          "type": "boolean"
        }
      },
      "required": [
        "projectId",
        "id",
        "name",
        "isBuiltin",
        "appliesToType",
        "isDefault"
      ],
      "additionalProperties": false
    },
    "T35": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "projectId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "name": {
          "type": "string"
        },
        "appliesToType": {
          "type": "string"
        },
        "isDefault": {
          "type": "boolean"
        },
        "isBuiltin": {
          "type": "boolean"
        }
      },
      "required": [
        "id",
        "projectId",
        "name",
        "appliesToType",
        "isDefault",
        "isBuiltin"
      ],
      "additionalProperties": false
    },
    "T36": {
      "type": "object",
      "properties": {
        "states": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T37"
          }
        }
      },
      "required": [
        "states"
      ],
      "additionalProperties": false
    },
    "T37": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "workflowId": {
          "type": "string"
        },
        "key": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "category": {
          "type": "string"
        },
        "color": {
          "type": "string"
        },
        "wipLimit": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "number"
            }
          ]
        },
        "sortOrder": {
          "type": "integer"
        },
        "archivedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        }
      },
      "required": [
        "id",
        "workflowId",
        "key",
        "name",
        "category",
        "color",
        "wipLimit",
        "sortOrder",
        "archivedAt"
      ],
      "additionalProperties": false
    },
    "T38": {
      "type": "object",
      "properties": {
        "key": {
          "type": "string"
        },
        "id": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "sortOrder": {
          "type": "integer"
        },
        "archivedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "category": {
          "type": "string"
        },
        "color": {
          "type": "string"
        },
        "workflowId": {
          "type": "string"
        },
        "wipLimit": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "number"
            }
          ]
        }
      },
      "required": [
        "key",
        "id",
        "name",
        "sortOrder",
        "archivedAt",
        "category",
        "color",
        "workflowId",
        "wipLimit"
      ],
      "additionalProperties": false
    },
    "T39": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "workflowId": {
          "type": "string"
        },
        "key": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "category": {
          "type": "string"
        },
        "color": {
          "type": "string"
        },
        "wipLimit": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "number"
            }
          ]
        },
        "sortOrder": {
          "type": "integer"
        },
        "archivedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        }
      },
      "required": [
        "id",
        "workflowId",
        "key",
        "name",
        "category",
        "color",
        "wipLimit",
        "sortOrder",
        "archivedAt"
      ],
      "additionalProperties": false
    },
    "T40": {
      "type": "object",
      "properties": {
        "ok": {
          "type": "boolean"
        }
      },
      "required": [
        "ok"
      ],
      "additionalProperties": false
    },
    "T41": {
      "type": "object",
      "properties": {
        "transitions": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T42"
          }
        }
      },
      "required": [
        "transitions"
      ],
      "additionalProperties": false
    },
    "T42": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "workflowId": {
          "type": "string"
        },
        "fromStateId": {
          "type": "string"
        },
        "toStateId": {
          "type": "string"
        },
        "allowedRoleIds": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "requiredFields": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "requiresApproval": {
          "type": "boolean"
        },
        "approverRoleKeys": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "label": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "sortOrder": {
          "type": "integer"
        }
      },
      "required": [
        "id",
        "workflowId",
        "fromStateId",
        "toStateId",
        "allowedRoleIds",
        "requiredFields",
        "requiresApproval",
        "approverRoleKeys",
        "label",
        "sortOrder"
      ],
      "additionalProperties": false
    },
    "T43": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "sortOrder": {
          "type": "integer"
        },
        "workflowId": {
          "type": "string"
        },
        "fromStateId": {
          "type": "string"
        },
        "toStateId": {
          "type": "string"
        },
        "allowedRoleIds": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "requiredFields": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "requiresApproval": {
          "type": "boolean"
        },
        "approverRoleKeys": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "label": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        }
      },
      "required": [
        "id",
        "sortOrder",
        "workflowId",
        "fromStateId",
        "toStateId",
        "allowedRoleIds",
        "requiredFields",
        "requiresApproval",
        "approverRoleKeys",
        "label"
      ],
      "additionalProperties": false
    },
    "T44": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "workflowId": {
          "type": "string"
        },
        "fromStateId": {
          "type": "string"
        },
        "toStateId": {
          "type": "string"
        },
        "allowedRoleIds": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "requiredFields": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "requiresApproval": {
          "type": "boolean"
        },
        "approverRoleKeys": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "label": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "sortOrder": {
          "type": "integer"
        }
      },
      "required": [
        "id",
        "workflowId",
        "fromStateId",
        "toStateId",
        "allowedRoleIds",
        "requiredFields",
        "requiresApproval",
        "approverRoleKeys",
        "label",
        "sortOrder"
      ],
      "additionalProperties": false
    },
    "T45": {
      "type": "object",
      "properties": {
        "ok": {
          "type": "boolean"
        }
      },
      "required": [
        "ok"
      ],
      "additionalProperties": false
    },
    "T46": {
      "type": "object",
      "properties": {
        "revisions": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T47"
          }
        }
      },
      "required": [
        "revisions"
      ],
      "additionalProperties": false
    },
    "T47": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "revisionNo": {
          "type": "integer"
        },
        "changeSummary": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "authorId": {
          "type": "string"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "revisionNo",
        "changeSummary",
        "authorId",
        "createdAt"
      ],
      "additionalProperties": false
    },
    "T48": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "pageId": {
          "type": "string"
        },
        "revisionNo": {
          "type": "integer"
        },
        "content": {
          "type": "string"
        },
        "changeSummary": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "authorId": {
          "type": "string"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "pageId",
        "revisionNo",
        "content",
        "changeSummary",
        "authorId",
        "createdAt"
      ],
      "additionalProperties": false
    },
    "T49": {
      "type": "object",
      "properties": {
        "permissions": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T50"
          }
        }
      },
      "required": [
        "permissions"
      ],
      "additionalProperties": false
    },
    "T50": {
      "type": "object",
      "properties": {
        "pageId": {
          "type": "string"
        },
        "principalType": {
          "type": "string"
        },
        "principalId": {
          "type": "string"
        },
        "canRead": {
          "type": "boolean"
        },
        "canWrite": {
          "type": "boolean"
        }
      },
      "required": [
        "pageId",
        "principalType",
        "principalId",
        "canRead",
        "canWrite"
      ],
      "additionalProperties": false
    },
    "T51": {
      "type": "object",
      "properties": {
        "batches": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T52"
          }
        }
      },
      "required": [
        "batches"
      ],
      "additionalProperties": false
    },
    "T52": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "projectId": {
          "type": "string"
        },
        "source": {
          "type": "string"
        },
        "filename": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "status": {
          "type": "string"
        },
        "mappingConfig": {
          "$ref": "#/$defs/JsonValue"
        },
        "totalRows": {
          "type": "number"
        },
        "createdCount": {
          "type": "integer"
        },
        "failedCount": {
          "type": "integer"
        },
        "errorReport": {
          "$ref": "#/$defs/JsonValue"
        },
        "createdBy": {
          "type": "string"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "startedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "finishedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        }
      },
      "required": [
        "id",
        "projectId",
        "source",
        "filename",
        "status",
        "mappingConfig",
        "totalRows",
        "createdCount",
        "failedCount",
        "errorReport",
        "createdBy",
        "createdAt",
        "startedAt",
        "finishedAt"
      ],
      "additionalProperties": false
    },
    "T53": {
      "type": "object",
      "properties": {
        "rows": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/JsonValue"
          }
        },
        "offset": {
          "type": "integer"
        },
        "limit": {
          "type": "integer"
        },
        "hasMore": {
          "type": "boolean"
        },
        "errorReport": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/JsonValue"
          }
        },
        "errorOffset": {
          "type": "number"
        },
        "errorLimit": {
          "type": "number"
        },
        "errorCount": {
          "type": "integer"
        },
        "errorHasMore": {
          "type": "boolean"
        },
        "header": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "fieldMap": {
          "type": "object",
          "additionalProperties": {
            "type": "string"
          }
        },
        "encoding": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "$ref": "#/$defs/JsonValue"
            }
          ]
        },
        "preview": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "$ref": "#/$defs/JsonValue"
            }
          ]
        },
        "id": {
          "type": "string"
        },
        "projectId": {
          "type": "string"
        },
        "source": {
          "type": "string"
        },
        "filename": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "status": {
          "type": "string"
        },
        "mappingConfig": {
          "$ref": "#/$defs/JsonValue"
        },
        "totalRows": {
          "type": "number"
        },
        "createdCount": {
          "type": "integer"
        },
        "failedCount": {
          "type": "integer"
        },
        "createdBy": {
          "type": "string"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "startedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "finishedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        }
      },
      "required": [
        "rows",
        "offset",
        "limit",
        "hasMore",
        "errorReport",
        "errorOffset",
        "errorLimit",
        "errorCount",
        "errorHasMore",
        "header",
        "fieldMap",
        "encoding",
        "preview",
        "id",
        "projectId",
        "source",
        "filename",
        "status",
        "mappingConfig",
        "totalRows",
        "createdCount",
        "failedCount",
        "createdBy",
        "createdAt",
        "startedAt",
        "finishedAt"
      ],
      "additionalProperties": false
    },
    "T54": {
      "type": "object",
      "properties": {
        "source": {
          "type": "string"
        },
        "fieldMap": {
          "type": "object",
          "additionalProperties": {
            "type": "string"
          }
        },
        "valueMaps": {
          "type": "object",
          "additionalProperties": {
            "type": "object",
            "additionalProperties": {
              "type": "string"
            }
          }
        },
        "externalIdColumn": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "unmatchedColumns": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "notes": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "delimiter": {
          "type": "string"
        }
      },
      "required": [
        "source",
        "fieldMap",
        "valueMaps",
        "externalIdColumn",
        "unmatchedColumns",
        "notes",
        "delimiter"
      ],
      "additionalProperties": false
    },
    "T55": {
      "type": "object",
      "properties": {
        "count": {
          "type": "number"
        },
        "filename": {
          "type": "string"
        },
        "mimeType": {
          "type": "string"
        },
        "contentBase64": {
          "type": "string"
        },
        "size": {
          "type": "number"
        }
      },
      "required": [
        "count",
        "filename",
        "mimeType",
        "contentBase64",
        "size"
      ],
      "additionalProperties": false
    },
    "T56": {
      "type": "object",
      "properties": {
        "filename": {
          "type": "string"
        },
        "mimeType": {
          "type": "string"
        },
        "contentBase64": {
          "type": "string"
        },
        "size": {
          "type": "number"
        }
      },
      "required": [
        "filename",
        "mimeType",
        "contentBase64",
        "size"
      ],
      "additionalProperties": false
    },
    "T57": {
      "type": "object",
      "properties": {
        "toolCount": {
          "type": "integer"
        },
        "tools": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T58"
          }
        },
        "workflows": {
          "type": "array",
          "items": {
            "anyOf": [
              {
                "$ref": "#/$defs/T59"
              },
              {
                "$ref": "#/$defs/T60"
              },
              {
                "$ref": "#/$defs/T61"
              },
              {
                "$ref": "#/$defs/T62"
              },
              {
                "$ref": "#/$defs/T63"
              },
              {
                "$ref": "#/$defs/T64"
              },
              {
                "$ref": "#/$defs/T65"
              },
              {
                "$ref": "#/$defs/T66"
              },
              {
                "$ref": "#/$defs/T67"
              },
              {
                "$ref": "#/$defs/T68"
              },
              {
                "$ref": "#/$defs/T69"
              },
              {
                "$ref": "#/$defs/T70"
              },
              {
                "$ref": "#/$defs/T71"
              },
              {
                "$ref": "#/$defs/T72"
              },
              {
                "$ref": "#/$defs/T73"
              },
              {
                "$ref": "#/$defs/T74"
              },
              {
                "$ref": "#/$defs/T75"
              },
              {
                "$ref": "#/$defs/T76"
              },
              {
                "$ref": "#/$defs/T77"
              },
              {
                "$ref": "#/$defs/T78"
              },
              {
                "$ref": "#/$defs/T79"
              }
            ]
          }
        },
        "completionRule": {
          "type": "string"
        },
        "boundaries": {
          "$ref": "#/$defs/T80"
        }
      },
      "required": [
        "toolCount",
        "tools",
        "workflows",
        "completionRule",
        "boundaries"
      ],
      "additionalProperties": false
    },
    "T58": {
      "type": "object",
      "properties": {
        "available": {
          "type": "boolean"
        },
        "reason": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "description": {
          "type": "string"
        },
        "kind": {
          "type": "string",
          "enum": [
            "read",
            "write"
          ]
        },
        "scope": {
          "type": "string"
        },
        "confirmationRequired": {
          "type": "boolean"
        },
        "idempotentWithoutKey": {
          "type": "boolean"
        },
        "idempotencyKey": {
          "type": "boolean"
        }
      },
      "required": [
        "available",
        "reason",
        "name",
        "description",
        "kind",
        "scope",
        "confirmationRequired",
        "idempotentWithoutKey",
        "idempotencyKey"
      ],
      "additionalProperties": false
    },
    "T59": {
      "type": "object",
      "properties": {
        "missingTools": {
          "type": "array",
          "items": {
            "type": "string",
            "enum": [
              "workitem.transfer",
              "workitem.addCollaborator",
              "customField.setValues",
              "workflow.list",
              "workflow.addState",
              "workflow.addTransition",
              "workflow.updateTransition",
              "page.revisions",
              "import.get",
              "import.suggestions",
              "workitem.transition",
              "savedView.update",
              "automation.createRule",
              "automation.updateRule",
              "role.assign",
              "organization.assignMember",
              "workitem.link",
              "idea.vote",
              "idea.promote",
              "plan.completeIteration",
              "plan.completeRelease",
              "project.context",
              "workitem.list",
              "workitem.create",
              "workitem.children",
              "workitem.update",
              "workitem.assign",
              "workitem.get",
              "workitem.comment",
              "plan.listIterations",
              "plan.createIteration",
              "plan.getIteration",
              "plan.updateIteration",
              "plan.getRelease",
              "plan.archiveIteration",
              "plan.unarchiveIteration",
              "idea.list",
              "idea.get",
              "idea.update",
              "page.list",
              "page.get",
              "page.update",
              "page.restore",
              "automation.listRules",
              "automation.testRule",
              "automation.listRuns",
              "import.create",
              "import.setMapping",
              "import.dryRun",
              "import.confirm",
              "import.rollback",
              "intake.listForms",
              "intake.listSubmissions",
              "intake.convertSubmission",
              "project.create",
              "member.list",
              "role.list",
              "project.member.add",
              "project.members",
              "project.update",
              "project.get",
              "insight.burnDown",
              "insight.cumulativeFlow",
              "project.report",
              "workflow.states",
              "meta.workflow",
              "todo.list",
              "todo.create",
              "todo.update",
              "focus.blocks",
              "focus.createBlock",
              "focus.recordSession",
              "focus.today",
              "workitem.relations",
              "workitem.unlink",
              "workitem.collaborators",
              "workitem.transfers",
              "timeLog.create",
              "timeLog.list",
              "workitem.addProgressUpdate",
              "workitem.progressUpdates",
              "plan.addMilestoneProgressUpdate",
              "plan.milestoneDetail",
              "attachment.list",
              "attachment.upload",
              "attachment.download",
              "attachment.remove",
              "customField.definitions",
              "customField.create",
              "customField.getValues",
              "savedView.list",
              "savedView.create",
              "savedView.get",
              "savedView.reorder",
              "sla.listPolicies",
              "sla.createPolicy",
              "sla.get",
              "approval.list",
              "approval.approve",
              "dashboard.list",
              "dashboard.create",
              "dashboard.widgets.create",
              "dashboard.widgets.data",
              "dashboard.get",
              "portfolio.list",
              "portfolio.create",
              "portfolio.addProject",
              "portfolio.get",
              "portfolio.summary",
              "organization.departments",
              "organization.positions",
              "team.list",
              "role.assignments"
            ]
          }
        },
        "id": {
          "type": "string",
          "const": "delivery"
        },
        "purpose": {
          "type": "string",
          "const": "需求拆解、排期、执行与验收回写"
        },
        "steps": {
          "type": "array",
          "items": {
            "anyOf": [
              {
                "type": "string",
                "const": "project.context"
              },
              {
                "type": "string",
                "const": "workitem.list"
              },
              {
                "type": "string",
                "const": "workitem.create"
              },
              {
                "type": "string",
                "const": "workitem.children"
              },
              {
                "type": "string",
                "const": "workitem.update"
              },
              {
                "type": "string",
                "const": "workitem.assign"
              },
              {
                "type": "string",
                "const": "workitem.get"
              },
              {
                "type": "string",
                "const": "workitem.transition"
              },
              {
                "type": "string",
                "const": "workitem.comment"
              },
              {
                "type": "string",
                "const": "workitem.get"
              }
            ]
          }
        }
      },
      "required": [
        "missingTools",
        "id",
        "purpose",
        "steps"
      ],
      "additionalProperties": false
    },
    "T60": {
      "type": "object",
      "properties": {
        "missingTools": {
          "type": "array",
          "items": {
            "type": "string",
            "enum": [
              "workitem.transfer",
              "workitem.addCollaborator",
              "customField.setValues",
              "workflow.list",
              "workflow.addState",
              "workflow.addTransition",
              "workflow.updateTransition",
              "page.revisions",
              "import.get",
              "import.suggestions",
              "workitem.transition",
              "savedView.update",
              "automation.createRule",
              "automation.updateRule",
              "role.assign",
              "organization.assignMember",
              "workitem.link",
              "idea.vote",
              "idea.promote",
              "plan.completeIteration",
              "plan.completeRelease",
              "project.context",
              "workitem.list",
              "workitem.create",
              "workitem.children",
              "workitem.update",
              "workitem.assign",
              "workitem.get",
              "workitem.comment",
              "plan.listIterations",
              "plan.createIteration",
              "plan.getIteration",
              "plan.updateIteration",
              "plan.getRelease",
              "plan.archiveIteration",
              "plan.unarchiveIteration",
              "idea.list",
              "idea.get",
              "idea.update",
              "page.list",
              "page.get",
              "page.update",
              "page.restore",
              "automation.listRules",
              "automation.testRule",
              "automation.listRuns",
              "import.create",
              "import.setMapping",
              "import.dryRun",
              "import.confirm",
              "import.rollback",
              "intake.listForms",
              "intake.listSubmissions",
              "intake.convertSubmission",
              "project.create",
              "member.list",
              "role.list",
              "project.member.add",
              "project.members",
              "project.update",
              "project.get",
              "insight.burnDown",
              "insight.cumulativeFlow",
              "project.report",
              "workflow.states",
              "meta.workflow",
              "todo.list",
              "todo.create",
              "todo.update",
              "focus.blocks",
              "focus.createBlock",
              "focus.recordSession",
              "focus.today",
              "workitem.relations",
              "workitem.unlink",
              "workitem.collaborators",
              "workitem.transfers",
              "timeLog.create",
              "timeLog.list",
              "workitem.addProgressUpdate",
              "workitem.progressUpdates",
              "plan.addMilestoneProgressUpdate",
              "plan.milestoneDetail",
              "attachment.list",
              "attachment.upload",
              "attachment.download",
              "attachment.remove",
              "customField.definitions",
              "customField.create",
              "customField.getValues",
              "savedView.list",
              "savedView.create",
              "savedView.get",
              "savedView.reorder",
              "sla.listPolicies",
              "sla.createPolicy",
              "sla.get",
              "approval.list",
              "approval.approve",
              "dashboard.list",
              "dashboard.create",
              "dashboard.widgets.create",
              "dashboard.widgets.data",
              "dashboard.get",
              "portfolio.list",
              "portfolio.create",
              "portfolio.addProject",
              "portfolio.get",
              "portfolio.summary",
              "organization.departments",
              "organization.positions",
              "team.list",
              "role.assignments"
            ]
          }
        },
        "id": {
          "type": "string",
          "const": "planning"
        },
        "purpose": {
          "type": "string",
          "const": "创建计划、关联任务、迭代结束结转与版本完成归档"
        },
        "steps": {
          "type": "array",
          "items": {
            "anyOf": [
              {
                "type": "string",
                "const": "plan.listIterations"
              },
              {
                "type": "string",
                "const": "plan.createIteration"
              },
              {
                "type": "string",
                "const": "workitem.list"
              },
              {
                "type": "string",
                "const": "workitem.update"
              },
              {
                "type": "string",
                "const": "plan.getIteration"
              },
              {
                "type": "string",
                "const": "plan.updateIteration"
              },
              {
                "type": "string",
                "const": "plan.completeIteration"
              },
              {
                "type": "string",
                "const": "plan.getIteration"
              },
              {
                "type": "string",
                "const": "plan.completeRelease"
              },
              {
                "type": "string",
                "const": "plan.getRelease"
              },
              {
                "type": "string",
                "const": "plan.archiveIteration"
              },
              {
                "type": "string",
                "const": "plan.unarchiveIteration"
              },
              {
                "type": "string",
                "const": "workitem.get"
              }
            ]
          }
        }
      },
      "required": [
        "missingTools",
        "id",
        "purpose",
        "steps"
      ],
      "additionalProperties": false
    },
    "T61": {
      "type": "object",
      "properties": {
        "missingTools": {
          "type": "array",
          "items": {
            "type": "string",
            "enum": [
              "workitem.transfer",
              "workitem.addCollaborator",
              "customField.setValues",
              "workflow.list",
              "workflow.addState",
              "workflow.addTransition",
              "workflow.updateTransition",
              "page.revisions",
              "import.get",
              "import.suggestions",
              "workitem.transition",
              "savedView.update",
              "automation.createRule",
              "automation.updateRule",
              "role.assign",
              "organization.assignMember",
              "workitem.link",
              "idea.vote",
              "idea.promote",
              "plan.completeIteration",
              "plan.completeRelease",
              "project.context",
              "workitem.list",
              "workitem.create",
              "workitem.children",
              "workitem.update",
              "workitem.assign",
              "workitem.get",
              "workitem.comment",
              "plan.listIterations",
              "plan.createIteration",
              "plan.getIteration",
              "plan.updateIteration",
              "plan.getRelease",
              "plan.archiveIteration",
              "plan.unarchiveIteration",
              "idea.list",
              "idea.get",
              "idea.update",
              "page.list",
              "page.get",
              "page.update",
              "page.restore",
              "automation.listRules",
              "automation.testRule",
              "automation.listRuns",
              "import.create",
              "import.setMapping",
              "import.dryRun",
              "import.confirm",
              "import.rollback",
              "intake.listForms",
              "intake.listSubmissions",
              "intake.convertSubmission",
              "project.create",
              "member.list",
              "role.list",
              "project.member.add",
              "project.members",
              "project.update",
              "project.get",
              "insight.burnDown",
              "insight.cumulativeFlow",
              "project.report",
              "workflow.states",
              "meta.workflow",
              "todo.list",
              "todo.create",
              "todo.update",
              "focus.blocks",
              "focus.createBlock",
              "focus.recordSession",
              "focus.today",
              "workitem.relations",
              "workitem.unlink",
              "workitem.collaborators",
              "workitem.transfers",
              "timeLog.create",
              "timeLog.list",
              "workitem.addProgressUpdate",
              "workitem.progressUpdates",
              "plan.addMilestoneProgressUpdate",
              "plan.milestoneDetail",
              "attachment.list",
              "attachment.upload",
              "attachment.download",
              "attachment.remove",
              "customField.definitions",
              "customField.create",
              "customField.getValues",
              "savedView.list",
              "savedView.create",
              "savedView.get",
              "savedView.reorder",
              "sla.listPolicies",
              "sla.createPolicy",
              "sla.get",
              "approval.list",
              "approval.approve",
              "dashboard.list",
              "dashboard.create",
              "dashboard.widgets.create",
              "dashboard.widgets.data",
              "dashboard.get",
              "portfolio.list",
              "portfolio.create",
              "portfolio.addProject",
              "portfolio.get",
              "portfolio.summary",
              "organization.departments",
              "organization.positions",
              "team.list",
              "role.assignments"
            ]
          }
        },
        "id": {
          "type": "string",
          "const": "ideas"
        },
        "purpose": {
          "type": "string",
          "const": "发现想法、评审、投票与转工作项"
        },
        "steps": {
          "type": "array",
          "items": {
            "anyOf": [
              {
                "type": "string",
                "const": "idea.list"
              },
              {
                "type": "string",
                "const": "idea.get"
              },
              {
                "type": "string",
                "const": "idea.update"
              },
              {
                "type": "string",
                "const": "idea.vote"
              },
              {
                "type": "string",
                "const": "idea.promote"
              },
              {
                "type": "string",
                "const": "workitem.get"
              }
            ]
          }
        }
      },
      "required": [
        "missingTools",
        "id",
        "purpose",
        "steps"
      ],
      "additionalProperties": false
    },
    "T62": {
      "type": "object",
      "properties": {
        "missingTools": {
          "type": "array",
          "items": {
            "type": "string",
            "enum": [
              "workitem.transfer",
              "workitem.addCollaborator",
              "customField.setValues",
              "workflow.list",
              "workflow.addState",
              "workflow.addTransition",
              "workflow.updateTransition",
              "page.revisions",
              "import.get",
              "import.suggestions",
              "workitem.transition",
              "savedView.update",
              "automation.createRule",
              "automation.updateRule",
              "role.assign",
              "organization.assignMember",
              "workitem.link",
              "idea.vote",
              "idea.promote",
              "plan.completeIteration",
              "plan.completeRelease",
              "project.context",
              "workitem.list",
              "workitem.create",
              "workitem.children",
              "workitem.update",
              "workitem.assign",
              "workitem.get",
              "workitem.comment",
              "plan.listIterations",
              "plan.createIteration",
              "plan.getIteration",
              "plan.updateIteration",
              "plan.getRelease",
              "plan.archiveIteration",
              "plan.unarchiveIteration",
              "idea.list",
              "idea.get",
              "idea.update",
              "page.list",
              "page.get",
              "page.update",
              "page.restore",
              "automation.listRules",
              "automation.testRule",
              "automation.listRuns",
              "import.create",
              "import.setMapping",
              "import.dryRun",
              "import.confirm",
              "import.rollback",
              "intake.listForms",
              "intake.listSubmissions",
              "intake.convertSubmission",
              "project.create",
              "member.list",
              "role.list",
              "project.member.add",
              "project.members",
              "project.update",
              "project.get",
              "insight.burnDown",
              "insight.cumulativeFlow",
              "project.report",
              "workflow.states",
              "meta.workflow",
              "todo.list",
              "todo.create",
              "todo.update",
              "focus.blocks",
              "focus.createBlock",
              "focus.recordSession",
              "focus.today",
              "workitem.relations",
              "workitem.unlink",
              "workitem.collaborators",
              "workitem.transfers",
              "timeLog.create",
              "timeLog.list",
              "workitem.addProgressUpdate",
              "workitem.progressUpdates",
              "plan.addMilestoneProgressUpdate",
              "plan.milestoneDetail",
              "attachment.list",
              "attachment.upload",
              "attachment.download",
              "attachment.remove",
              "customField.definitions",
              "customField.create",
              "customField.getValues",
              "savedView.list",
              "savedView.create",
              "savedView.get",
              "savedView.reorder",
              "sla.listPolicies",
              "sla.createPolicy",
              "sla.get",
              "approval.list",
              "approval.approve",
              "dashboard.list",
              "dashboard.create",
              "dashboard.widgets.create",
              "dashboard.widgets.data",
              "dashboard.get",
              "portfolio.list",
              "portfolio.create",
              "portfolio.addProject",
              "portfolio.get",
              "portfolio.summary",
              "organization.departments",
              "organization.positions",
              "team.list",
              "role.assignments"
            ]
          }
        },
        "id": {
          "type": "string",
          "const": "documentation"
        },
        "purpose": {
          "type": "string",
          "const": "文档编写、历史复核与恢复"
        },
        "steps": {
          "type": "array",
          "items": {
            "anyOf": [
              {
                "type": "string",
                "const": "page.list"
              },
              {
                "type": "string",
                "const": "page.get"
              },
              {
                "type": "string",
                "const": "page.update"
              },
              {
                "type": "string",
                "const": "page.revisions"
              },
              {
                "type": "string",
                "const": "page.restore"
              },
              {
                "type": "string",
                "const": "page.get"
              }
            ]
          }
        }
      },
      "required": [
        "missingTools",
        "id",
        "purpose",
        "steps"
      ],
      "additionalProperties": false
    },
    "T63": {
      "type": "object",
      "properties": {
        "missingTools": {
          "type": "array",
          "items": {
            "type": "string",
            "enum": [
              "workitem.transfer",
              "workitem.addCollaborator",
              "customField.setValues",
              "workflow.list",
              "workflow.addState",
              "workflow.addTransition",
              "workflow.updateTransition",
              "page.revisions",
              "import.get",
              "import.suggestions",
              "workitem.transition",
              "savedView.update",
              "automation.createRule",
              "automation.updateRule",
              "role.assign",
              "organization.assignMember",
              "workitem.link",
              "idea.vote",
              "idea.promote",
              "plan.completeIteration",
              "plan.completeRelease",
              "project.context",
              "workitem.list",
              "workitem.create",
              "workitem.children",
              "workitem.update",
              "workitem.assign",
              "workitem.get",
              "workitem.comment",
              "plan.listIterations",
              "plan.createIteration",
              "plan.getIteration",
              "plan.updateIteration",
              "plan.getRelease",
              "plan.archiveIteration",
              "plan.unarchiveIteration",
              "idea.list",
              "idea.get",
              "idea.update",
              "page.list",
              "page.get",
              "page.update",
              "page.restore",
              "automation.listRules",
              "automation.testRule",
              "automation.listRuns",
              "import.create",
              "import.setMapping",
              "import.dryRun",
              "import.confirm",
              "import.rollback",
              "intake.listForms",
              "intake.listSubmissions",
              "intake.convertSubmission",
              "project.create",
              "member.list",
              "role.list",
              "project.member.add",
              "project.members",
              "project.update",
              "project.get",
              "insight.burnDown",
              "insight.cumulativeFlow",
              "project.report",
              "workflow.states",
              "meta.workflow",
              "todo.list",
              "todo.create",
              "todo.update",
              "focus.blocks",
              "focus.createBlock",
              "focus.recordSession",
              "focus.today",
              "workitem.relations",
              "workitem.unlink",
              "workitem.collaborators",
              "workitem.transfers",
              "timeLog.create",
              "timeLog.list",
              "workitem.addProgressUpdate",
              "workitem.progressUpdates",
              "plan.addMilestoneProgressUpdate",
              "plan.milestoneDetail",
              "attachment.list",
              "attachment.upload",
              "attachment.download",
              "attachment.remove",
              "customField.definitions",
              "customField.create",
              "customField.getValues",
              "savedView.list",
              "savedView.create",
              "savedView.get",
              "savedView.reorder",
              "sla.listPolicies",
              "sla.createPolicy",
              "sla.get",
              "approval.list",
              "approval.approve",
              "dashboard.list",
              "dashboard.create",
              "dashboard.widgets.create",
              "dashboard.widgets.data",
              "dashboard.get",
              "portfolio.list",
              "portfolio.create",
              "portfolio.addProject",
              "portfolio.get",
              "portfolio.summary",
              "organization.departments",
              "organization.positions",
              "team.list",
              "role.assignments"
            ]
          }
        },
        "id": {
          "type": "string",
          "const": "automation"
        },
        "purpose": {
          "type": "string",
          "const": "规则建立、条件预演、修改与运行结果复核"
        },
        "steps": {
          "type": "array",
          "items": {
            "anyOf": [
              {
                "type": "string",
                "const": "automation.listRules"
              },
              {
                "type": "string",
                "const": "automation.createRule"
              },
              {
                "type": "string",
                "const": "automation.testRule"
              },
              {
                "type": "string",
                "const": "automation.updateRule"
              },
              {
                "type": "string",
                "const": "automation.listRuns"
              }
            ]
          }
        }
      },
      "required": [
        "missingTools",
        "id",
        "purpose",
        "steps"
      ],
      "additionalProperties": false
    },
    "T64": {
      "type": "object",
      "properties": {
        "missingTools": {
          "type": "array",
          "items": {
            "type": "string",
            "enum": [
              "workitem.transfer",
              "workitem.addCollaborator",
              "customField.setValues",
              "workflow.list",
              "workflow.addState",
              "workflow.addTransition",
              "workflow.updateTransition",
              "page.revisions",
              "import.get",
              "import.suggestions",
              "workitem.transition",
              "savedView.update",
              "automation.createRule",
              "automation.updateRule",
              "role.assign",
              "organization.assignMember",
              "workitem.link",
              "idea.vote",
              "idea.promote",
              "plan.completeIteration",
              "plan.completeRelease",
              "project.context",
              "workitem.list",
              "workitem.create",
              "workitem.children",
              "workitem.update",
              "workitem.assign",
              "workitem.get",
              "workitem.comment",
              "plan.listIterations",
              "plan.createIteration",
              "plan.getIteration",
              "plan.updateIteration",
              "plan.getRelease",
              "plan.archiveIteration",
              "plan.unarchiveIteration",
              "idea.list",
              "idea.get",
              "idea.update",
              "page.list",
              "page.get",
              "page.update",
              "page.restore",
              "automation.listRules",
              "automation.testRule",
              "automation.listRuns",
              "import.create",
              "import.setMapping",
              "import.dryRun",
              "import.confirm",
              "import.rollback",
              "intake.listForms",
              "intake.listSubmissions",
              "intake.convertSubmission",
              "project.create",
              "member.list",
              "role.list",
              "project.member.add",
              "project.members",
              "project.update",
              "project.get",
              "insight.burnDown",
              "insight.cumulativeFlow",
              "project.report",
              "workflow.states",
              "meta.workflow",
              "todo.list",
              "todo.create",
              "todo.update",
              "focus.blocks",
              "focus.createBlock",
              "focus.recordSession",
              "focus.today",
              "workitem.relations",
              "workitem.unlink",
              "workitem.collaborators",
              "workitem.transfers",
              "timeLog.create",
              "timeLog.list",
              "workitem.addProgressUpdate",
              "workitem.progressUpdates",
              "plan.addMilestoneProgressUpdate",
              "plan.milestoneDetail",
              "attachment.list",
              "attachment.upload",
              "attachment.download",
              "attachment.remove",
              "customField.definitions",
              "customField.create",
              "customField.getValues",
              "savedView.list",
              "savedView.create",
              "savedView.get",
              "savedView.reorder",
              "sla.listPolicies",
              "sla.createPolicy",
              "sla.get",
              "approval.list",
              "approval.approve",
              "dashboard.list",
              "dashboard.create",
              "dashboard.widgets.create",
              "dashboard.widgets.data",
              "dashboard.get",
              "portfolio.list",
              "portfolio.create",
              "portfolio.addProject",
              "portfolio.get",
              "portfolio.summary",
              "organization.departments",
              "organization.positions",
              "team.list",
              "role.assignments"
            ]
          }
        },
        "id": {
          "type": "string",
          "const": "import"
        },
        "purpose": {
          "type": "string",
          "const": "导入、映射确认、预演、执行与可控回滚"
        },
        "steps": {
          "type": "array",
          "items": {
            "anyOf": [
              {
                "type": "string",
                "const": "import.create"
              },
              {
                "type": "string",
                "const": "import.suggestions"
              },
              {
                "type": "string",
                "const": "import.setMapping"
              },
              {
                "type": "string",
                "const": "import.dryRun"
              },
              {
                "type": "string",
                "const": "import.confirm"
              },
              {
                "type": "string",
                "const": "import.get"
              },
              {
                "type": "string",
                "const": "import.rollback"
              }
            ]
          }
        }
      },
      "required": [
        "missingTools",
        "id",
        "purpose",
        "steps"
      ],
      "additionalProperties": false
    },
    "T65": {
      "type": "object",
      "properties": {
        "missingTools": {
          "type": "array",
          "items": {
            "type": "string",
            "enum": [
              "workitem.transfer",
              "workitem.addCollaborator",
              "customField.setValues",
              "workflow.list",
              "workflow.addState",
              "workflow.addTransition",
              "workflow.updateTransition",
              "page.revisions",
              "import.get",
              "import.suggestions",
              "workitem.transition",
              "savedView.update",
              "automation.createRule",
              "automation.updateRule",
              "role.assign",
              "organization.assignMember",
              "workitem.link",
              "idea.vote",
              "idea.promote",
              "plan.completeIteration",
              "plan.completeRelease",
              "project.context",
              "workitem.list",
              "workitem.create",
              "workitem.children",
              "workitem.update",
              "workitem.assign",
              "workitem.get",
              "workitem.comment",
              "plan.listIterations",
              "plan.createIteration",
              "plan.getIteration",
              "plan.updateIteration",
              "plan.getRelease",
              "plan.archiveIteration",
              "plan.unarchiveIteration",
              "idea.list",
              "idea.get",
              "idea.update",
              "page.list",
              "page.get",
              "page.update",
              "page.restore",
              "automation.listRules",
              "automation.testRule",
              "automation.listRuns",
              "import.create",
              "import.setMapping",
              "import.dryRun",
              "import.confirm",
              "import.rollback",
              "intake.listForms",
              "intake.listSubmissions",
              "intake.convertSubmission",
              "project.create",
              "member.list",
              "role.list",
              "project.member.add",
              "project.members",
              "project.update",
              "project.get",
              "insight.burnDown",
              "insight.cumulativeFlow",
              "project.report",
              "workflow.states",
              "meta.workflow",
              "todo.list",
              "todo.create",
              "todo.update",
              "focus.blocks",
              "focus.createBlock",
              "focus.recordSession",
              "focus.today",
              "workitem.relations",
              "workitem.unlink",
              "workitem.collaborators",
              "workitem.transfers",
              "timeLog.create",
              "timeLog.list",
              "workitem.addProgressUpdate",
              "workitem.progressUpdates",
              "plan.addMilestoneProgressUpdate",
              "plan.milestoneDetail",
              "attachment.list",
              "attachment.upload",
              "attachment.download",
              "attachment.remove",
              "customField.definitions",
              "customField.create",
              "customField.getValues",
              "savedView.list",
              "savedView.create",
              "savedView.get",
              "savedView.reorder",
              "sla.listPolicies",
              "sla.createPolicy",
              "sla.get",
              "approval.list",
              "approval.approve",
              "dashboard.list",
              "dashboard.create",
              "dashboard.widgets.create",
              "dashboard.widgets.data",
              "dashboard.get",
              "portfolio.list",
              "portfolio.create",
              "portfolio.addProject",
              "portfolio.get",
              "portfolio.summary",
              "organization.departments",
              "organization.positions",
              "team.list",
              "role.assignments"
            ]
          }
        },
        "id": {
          "type": "string",
          "const": "intake"
        },
        "purpose": {
          "type": "string",
          "const": "需求收集、评审与转化"
        },
        "steps": {
          "type": "array",
          "items": {
            "anyOf": [
              {
                "type": "string",
                "const": "intake.listForms"
              },
              {
                "type": "string",
                "const": "intake.listSubmissions"
              },
              {
                "type": "string",
                "const": "intake.convertSubmission"
              },
              {
                "type": "string",
                "const": "idea.get"
              },
              {
                "type": "string",
                "const": "idea.promote"
              },
              {
                "type": "string",
                "const": "workitem.get"
              }
            ]
          }
        }
      },
      "required": [
        "missingTools",
        "id",
        "purpose",
        "steps"
      ],
      "additionalProperties": false
    },
    "T66": {
      "type": "object",
      "properties": {
        "missingTools": {
          "type": "array",
          "items": {
            "type": "string",
            "enum": [
              "workitem.transfer",
              "workitem.addCollaborator",
              "customField.setValues",
              "workflow.list",
              "workflow.addState",
              "workflow.addTransition",
              "workflow.updateTransition",
              "page.revisions",
              "import.get",
              "import.suggestions",
              "workitem.transition",
              "savedView.update",
              "automation.createRule",
              "automation.updateRule",
              "role.assign",
              "organization.assignMember",
              "workitem.link",
              "idea.vote",
              "idea.promote",
              "plan.completeIteration",
              "plan.completeRelease",
              "project.context",
              "workitem.list",
              "workitem.create",
              "workitem.children",
              "workitem.update",
              "workitem.assign",
              "workitem.get",
              "workitem.comment",
              "plan.listIterations",
              "plan.createIteration",
              "plan.getIteration",
              "plan.updateIteration",
              "plan.getRelease",
              "plan.archiveIteration",
              "plan.unarchiveIteration",
              "idea.list",
              "idea.get",
              "idea.update",
              "page.list",
              "page.get",
              "page.update",
              "page.restore",
              "automation.listRules",
              "automation.testRule",
              "automation.listRuns",
              "import.create",
              "import.setMapping",
              "import.dryRun",
              "import.confirm",
              "import.rollback",
              "intake.listForms",
              "intake.listSubmissions",
              "intake.convertSubmission",
              "project.create",
              "member.list",
              "role.list",
              "project.member.add",
              "project.members",
              "project.update",
              "project.get",
              "insight.burnDown",
              "insight.cumulativeFlow",
              "project.report",
              "workflow.states",
              "meta.workflow",
              "todo.list",
              "todo.create",
              "todo.update",
              "focus.blocks",
              "focus.createBlock",
              "focus.recordSession",
              "focus.today",
              "workitem.relations",
              "workitem.unlink",
              "workitem.collaborators",
              "workitem.transfers",
              "timeLog.create",
              "timeLog.list",
              "workitem.addProgressUpdate",
              "workitem.progressUpdates",
              "plan.addMilestoneProgressUpdate",
              "plan.milestoneDetail",
              "attachment.list",
              "attachment.upload",
              "attachment.download",
              "attachment.remove",
              "customField.definitions",
              "customField.create",
              "customField.getValues",
              "savedView.list",
              "savedView.create",
              "savedView.get",
              "savedView.reorder",
              "sla.listPolicies",
              "sla.createPolicy",
              "sla.get",
              "approval.list",
              "approval.approve",
              "dashboard.list",
              "dashboard.create",
              "dashboard.widgets.create",
              "dashboard.widgets.data",
              "dashboard.get",
              "portfolio.list",
              "portfolio.create",
              "portfolio.addProject",
              "portfolio.get",
              "portfolio.summary",
              "organization.departments",
              "organization.positions",
              "team.list",
              "role.assignments"
            ]
          }
        },
        "id": {
          "type": "string",
          "const": "project"
        },
        "purpose": {
          "type": "string",
          "const": "项目创建、成员配置与生命周期管理"
        },
        "steps": {
          "type": "array",
          "items": {
            "anyOf": [
              {
                "type": "string",
                "const": "project.create"
              },
              {
                "type": "string",
                "const": "member.list"
              },
              {
                "type": "string",
                "const": "role.list"
              },
              {
                "type": "string",
                "const": "project.member.add"
              },
              {
                "type": "string",
                "const": "project.members"
              },
              {
                "type": "string",
                "const": "project.update"
              },
              {
                "type": "string",
                "const": "project.get"
              }
            ]
          }
        }
      },
      "required": [
        "missingTools",
        "id",
        "purpose",
        "steps"
      ],
      "additionalProperties": false
    },
    "T67": {
      "type": "object",
      "properties": {
        "missingTools": {
          "type": "array",
          "items": {
            "type": "string",
            "enum": [
              "workitem.transfer",
              "workitem.addCollaborator",
              "customField.setValues",
              "workflow.list",
              "workflow.addState",
              "workflow.addTransition",
              "workflow.updateTransition",
              "page.revisions",
              "import.get",
              "import.suggestions",
              "workitem.transition",
              "savedView.update",
              "automation.createRule",
              "automation.updateRule",
              "role.assign",
              "organization.assignMember",
              "workitem.link",
              "idea.vote",
              "idea.promote",
              "plan.completeIteration",
              "plan.completeRelease",
              "project.context",
              "workitem.list",
              "workitem.create",
              "workitem.children",
              "workitem.update",
              "workitem.assign",
              "workitem.get",
              "workitem.comment",
              "plan.listIterations",
              "plan.createIteration",
              "plan.getIteration",
              "plan.updateIteration",
              "plan.getRelease",
              "plan.archiveIteration",
              "plan.unarchiveIteration",
              "idea.list",
              "idea.get",
              "idea.update",
              "page.list",
              "page.get",
              "page.update",
              "page.restore",
              "automation.listRules",
              "automation.testRule",
              "automation.listRuns",
              "import.create",
              "import.setMapping",
              "import.dryRun",
              "import.confirm",
              "import.rollback",
              "intake.listForms",
              "intake.listSubmissions",
              "intake.convertSubmission",
              "project.create",
              "member.list",
              "role.list",
              "project.member.add",
              "project.members",
              "project.update",
              "project.get",
              "insight.burnDown",
              "insight.cumulativeFlow",
              "project.report",
              "workflow.states",
              "meta.workflow",
              "todo.list",
              "todo.create",
              "todo.update",
              "focus.blocks",
              "focus.createBlock",
              "focus.recordSession",
              "focus.today",
              "workitem.relations",
              "workitem.unlink",
              "workitem.collaborators",
              "workitem.transfers",
              "timeLog.create",
              "timeLog.list",
              "workitem.addProgressUpdate",
              "workitem.progressUpdates",
              "plan.addMilestoneProgressUpdate",
              "plan.milestoneDetail",
              "attachment.list",
              "attachment.upload",
              "attachment.download",
              "attachment.remove",
              "customField.definitions",
              "customField.create",
              "customField.getValues",
              "savedView.list",
              "savedView.create",
              "savedView.get",
              "savedView.reorder",
              "sla.listPolicies",
              "sla.createPolicy",
              "sla.get",
              "approval.list",
              "approval.approve",
              "dashboard.list",
              "dashboard.create",
              "dashboard.widgets.create",
              "dashboard.widgets.data",
              "dashboard.get",
              "portfolio.list",
              "portfolio.create",
              "portfolio.addProject",
              "portfolio.get",
              "portfolio.summary",
              "organization.departments",
              "organization.positions",
              "team.list",
              "role.assignments"
            ]
          }
        },
        "id": {
          "type": "string",
          "const": "analysis"
        },
        "purpose": {
          "type": "string",
          "const": "迭代分析与项目报告"
        },
        "steps": {
          "type": "array",
          "items": {
            "anyOf": [
              {
                "type": "string",
                "const": "plan.listIterations"
              },
              {
                "type": "string",
                "const": "insight.burnDown"
              },
              {
                "type": "string",
                "const": "insight.cumulativeFlow"
              },
              {
                "type": "string",
                "const": "project.report"
              }
            ]
          }
        }
      },
      "required": [
        "missingTools",
        "id",
        "purpose",
        "steps"
      ],
      "additionalProperties": false
    },
    "T68": {
      "type": "object",
      "properties": {
        "missingTools": {
          "type": "array",
          "items": {
            "type": "string",
            "enum": [
              "workitem.transfer",
              "workitem.addCollaborator",
              "customField.setValues",
              "workflow.list",
              "workflow.addState",
              "workflow.addTransition",
              "workflow.updateTransition",
              "page.revisions",
              "import.get",
              "import.suggestions",
              "workitem.transition",
              "savedView.update",
              "automation.createRule",
              "automation.updateRule",
              "role.assign",
              "organization.assignMember",
              "workitem.link",
              "idea.vote",
              "idea.promote",
              "plan.completeIteration",
              "plan.completeRelease",
              "project.context",
              "workitem.list",
              "workitem.create",
              "workitem.children",
              "workitem.update",
              "workitem.assign",
              "workitem.get",
              "workitem.comment",
              "plan.listIterations",
              "plan.createIteration",
              "plan.getIteration",
              "plan.updateIteration",
              "plan.getRelease",
              "plan.archiveIteration",
              "plan.unarchiveIteration",
              "idea.list",
              "idea.get",
              "idea.update",
              "page.list",
              "page.get",
              "page.update",
              "page.restore",
              "automation.listRules",
              "automation.testRule",
              "automation.listRuns",
              "import.create",
              "import.setMapping",
              "import.dryRun",
              "import.confirm",
              "import.rollback",
              "intake.listForms",
              "intake.listSubmissions",
              "intake.convertSubmission",
              "project.create",
              "member.list",
              "role.list",
              "project.member.add",
              "project.members",
              "project.update",
              "project.get",
              "insight.burnDown",
              "insight.cumulativeFlow",
              "project.report",
              "workflow.states",
              "meta.workflow",
              "todo.list",
              "todo.create",
              "todo.update",
              "focus.blocks",
              "focus.createBlock",
              "focus.recordSession",
              "focus.today",
              "workitem.relations",
              "workitem.unlink",
              "workitem.collaborators",
              "workitem.transfers",
              "timeLog.create",
              "timeLog.list",
              "workitem.addProgressUpdate",
              "workitem.progressUpdates",
              "plan.addMilestoneProgressUpdate",
              "plan.milestoneDetail",
              "attachment.list",
              "attachment.upload",
              "attachment.download",
              "attachment.remove",
              "customField.definitions",
              "customField.create",
              "customField.getValues",
              "savedView.list",
              "savedView.create",
              "savedView.get",
              "savedView.reorder",
              "sla.listPolicies",
              "sla.createPolicy",
              "sla.get",
              "approval.list",
              "approval.approve",
              "dashboard.list",
              "dashboard.create",
              "dashboard.widgets.create",
              "dashboard.widgets.data",
              "dashboard.get",
              "portfolio.list",
              "portfolio.create",
              "portfolio.addProject",
              "portfolio.get",
              "portfolio.summary",
              "organization.departments",
              "organization.positions",
              "team.list",
              "role.assignments"
            ]
          }
        },
        "id": {
          "type": "string",
          "const": "workflow"
        },
        "purpose": {
          "type": "string",
          "const": "配置工作流、审批边与状态"
        },
        "steps": {
          "type": "array",
          "items": {
            "anyOf": [
              {
                "type": "string",
                "const": "workflow.list"
              },
              {
                "type": "string",
                "const": "workflow.states"
              },
              {
                "type": "string",
                "const": "workflow.addState"
              },
              {
                "type": "string",
                "const": "workflow.addTransition"
              },
              {
                "type": "string",
                "const": "workflow.updateTransition"
              },
              {
                "type": "string",
                "const": "meta.workflow"
              }
            ]
          }
        }
      },
      "required": [
        "missingTools",
        "id",
        "purpose",
        "steps"
      ],
      "additionalProperties": false
    },
    "T69": {
      "type": "object",
      "properties": {
        "missingTools": {
          "type": "array",
          "items": {
            "type": "string",
            "enum": [
              "workitem.transfer",
              "workitem.addCollaborator",
              "customField.setValues",
              "workflow.list",
              "workflow.addState",
              "workflow.addTransition",
              "workflow.updateTransition",
              "page.revisions",
              "import.get",
              "import.suggestions",
              "workitem.transition",
              "savedView.update",
              "automation.createRule",
              "automation.updateRule",
              "role.assign",
              "organization.assignMember",
              "workitem.link",
              "idea.vote",
              "idea.promote",
              "plan.completeIteration",
              "plan.completeRelease",
              "project.context",
              "workitem.list",
              "workitem.create",
              "workitem.children",
              "workitem.update",
              "workitem.assign",
              "workitem.get",
              "workitem.comment",
              "plan.listIterations",
              "plan.createIteration",
              "plan.getIteration",
              "plan.updateIteration",
              "plan.getRelease",
              "plan.archiveIteration",
              "plan.unarchiveIteration",
              "idea.list",
              "idea.get",
              "idea.update",
              "page.list",
              "page.get",
              "page.update",
              "page.restore",
              "automation.listRules",
              "automation.testRule",
              "automation.listRuns",
              "import.create",
              "import.setMapping",
              "import.dryRun",
              "import.confirm",
              "import.rollback",
              "intake.listForms",
              "intake.listSubmissions",
              "intake.convertSubmission",
              "project.create",
              "member.list",
              "role.list",
              "project.member.add",
              "project.members",
              "project.update",
              "project.get",
              "insight.burnDown",
              "insight.cumulativeFlow",
              "project.report",
              "workflow.states",
              "meta.workflow",
              "todo.list",
              "todo.create",
              "todo.update",
              "focus.blocks",
              "focus.createBlock",
              "focus.recordSession",
              "focus.today",
              "workitem.relations",
              "workitem.unlink",
              "workitem.collaborators",
              "workitem.transfers",
              "timeLog.create",
              "timeLog.list",
              "workitem.addProgressUpdate",
              "workitem.progressUpdates",
              "plan.addMilestoneProgressUpdate",
              "plan.milestoneDetail",
              "attachment.list",
              "attachment.upload",
              "attachment.download",
              "attachment.remove",
              "customField.definitions",
              "customField.create",
              "customField.getValues",
              "savedView.list",
              "savedView.create",
              "savedView.get",
              "savedView.reorder",
              "sla.listPolicies",
              "sla.createPolicy",
              "sla.get",
              "approval.list",
              "approval.approve",
              "dashboard.list",
              "dashboard.create",
              "dashboard.widgets.create",
              "dashboard.widgets.data",
              "dashboard.get",
              "portfolio.list",
              "portfolio.create",
              "portfolio.addProject",
              "portfolio.get",
              "portfolio.summary",
              "organization.departments",
              "organization.positions",
              "team.list",
              "role.assignments"
            ]
          }
        },
        "id": {
          "type": "string",
          "const": "personal"
        },
        "purpose": {
          "type": "string",
          "const": "本人待办、时间安排与专注记录"
        },
        "steps": {
          "type": "array",
          "items": {
            "anyOf": [
              {
                "type": "string",
                "const": "todo.list"
              },
              {
                "type": "string",
                "const": "todo.create"
              },
              {
                "type": "string",
                "const": "todo.update"
              },
              {
                "type": "string",
                "const": "focus.blocks"
              },
              {
                "type": "string",
                "const": "focus.createBlock"
              },
              {
                "type": "string",
                "const": "focus.recordSession"
              },
              {
                "type": "string",
                "const": "focus.today"
              }
            ]
          }
        }
      },
      "required": [
        "missingTools",
        "id",
        "purpose",
        "steps"
      ],
      "additionalProperties": false
    },
    "T70": {
      "type": "object",
      "properties": {
        "missingTools": {
          "type": "array",
          "items": {
            "type": "string",
            "enum": [
              "workitem.transfer",
              "workitem.addCollaborator",
              "customField.setValues",
              "workflow.list",
              "workflow.addState",
              "workflow.addTransition",
              "workflow.updateTransition",
              "page.revisions",
              "import.get",
              "import.suggestions",
              "workitem.transition",
              "savedView.update",
              "automation.createRule",
              "automation.updateRule",
              "role.assign",
              "organization.assignMember",
              "workitem.link",
              "idea.vote",
              "idea.promote",
              "plan.completeIteration",
              "plan.completeRelease",
              "project.context",
              "workitem.list",
              "workitem.create",
              "workitem.children",
              "workitem.update",
              "workitem.assign",
              "workitem.get",
              "workitem.comment",
              "plan.listIterations",
              "plan.createIteration",
              "plan.getIteration",
              "plan.updateIteration",
              "plan.getRelease",
              "plan.archiveIteration",
              "plan.unarchiveIteration",
              "idea.list",
              "idea.get",
              "idea.update",
              "page.list",
              "page.get",
              "page.update",
              "page.restore",
              "automation.listRules",
              "automation.testRule",
              "automation.listRuns",
              "import.create",
              "import.setMapping",
              "import.dryRun",
              "import.confirm",
              "import.rollback",
              "intake.listForms",
              "intake.listSubmissions",
              "intake.convertSubmission",
              "project.create",
              "member.list",
              "role.list",
              "project.member.add",
              "project.members",
              "project.update",
              "project.get",
              "insight.burnDown",
              "insight.cumulativeFlow",
              "project.report",
              "workflow.states",
              "meta.workflow",
              "todo.list",
              "todo.create",
              "todo.update",
              "focus.blocks",
              "focus.createBlock",
              "focus.recordSession",
              "focus.today",
              "workitem.relations",
              "workitem.unlink",
              "workitem.collaborators",
              "workitem.transfers",
              "timeLog.create",
              "timeLog.list",
              "workitem.addProgressUpdate",
              "workitem.progressUpdates",
              "plan.addMilestoneProgressUpdate",
              "plan.milestoneDetail",
              "attachment.list",
              "attachment.upload",
              "attachment.download",
              "attachment.remove",
              "customField.definitions",
              "customField.create",
              "customField.getValues",
              "savedView.list",
              "savedView.create",
              "savedView.get",
              "savedView.reorder",
              "sla.listPolicies",
              "sla.createPolicy",
              "sla.get",
              "approval.list",
              "approval.approve",
              "dashboard.list",
              "dashboard.create",
              "dashboard.widgets.create",
              "dashboard.widgets.data",
              "dashboard.get",
              "portfolio.list",
              "portfolio.create",
              "portfolio.addProject",
              "portfolio.get",
              "portfolio.summary",
              "organization.departments",
              "organization.positions",
              "team.list",
              "role.assignments"
            ]
          }
        },
        "id": {
          "type": "string",
          "const": "dependencies"
        },
        "purpose": {
          "type": "string",
          "const": "依赖建立、无环校验、复读与解除"
        },
        "steps": {
          "type": "array",
          "items": {
            "anyOf": [
              {
                "type": "string",
                "const": "workitem.get"
              },
              {
                "type": "string",
                "const": "workitem.relations"
              },
              {
                "type": "string",
                "const": "workitem.link"
              },
              {
                "type": "string",
                "const": "workitem.relations"
              },
              {
                "type": "string",
                "const": "workitem.unlink"
              }
            ]
          }
        }
      },
      "required": [
        "missingTools",
        "id",
        "purpose",
        "steps"
      ],
      "additionalProperties": false
    },
    "T71": {
      "type": "object",
      "properties": {
        "missingTools": {
          "type": "array",
          "items": {
            "type": "string",
            "enum": [
              "workitem.transfer",
              "workitem.addCollaborator",
              "customField.setValues",
              "workflow.list",
              "workflow.addState",
              "workflow.addTransition",
              "workflow.updateTransition",
              "page.revisions",
              "import.get",
              "import.suggestions",
              "workitem.transition",
              "savedView.update",
              "automation.createRule",
              "automation.updateRule",
              "role.assign",
              "organization.assignMember",
              "workitem.link",
              "idea.vote",
              "idea.promote",
              "plan.completeIteration",
              "plan.completeRelease",
              "project.context",
              "workitem.list",
              "workitem.create",
              "workitem.children",
              "workitem.update",
              "workitem.assign",
              "workitem.get",
              "workitem.comment",
              "plan.listIterations",
              "plan.createIteration",
              "plan.getIteration",
              "plan.updateIteration",
              "plan.getRelease",
              "plan.archiveIteration",
              "plan.unarchiveIteration",
              "idea.list",
              "idea.get",
              "idea.update",
              "page.list",
              "page.get",
              "page.update",
              "page.restore",
              "automation.listRules",
              "automation.testRule",
              "automation.listRuns",
              "import.create",
              "import.setMapping",
              "import.dryRun",
              "import.confirm",
              "import.rollback",
              "intake.listForms",
              "intake.listSubmissions",
              "intake.convertSubmission",
              "project.create",
              "member.list",
              "role.list",
              "project.member.add",
              "project.members",
              "project.update",
              "project.get",
              "insight.burnDown",
              "insight.cumulativeFlow",
              "project.report",
              "workflow.states",
              "meta.workflow",
              "todo.list",
              "todo.create",
              "todo.update",
              "focus.blocks",
              "focus.createBlock",
              "focus.recordSession",
              "focus.today",
              "workitem.relations",
              "workitem.unlink",
              "workitem.collaborators",
              "workitem.transfers",
              "timeLog.create",
              "timeLog.list",
              "workitem.addProgressUpdate",
              "workitem.progressUpdates",
              "plan.addMilestoneProgressUpdate",
              "plan.milestoneDetail",
              "attachment.list",
              "attachment.upload",
              "attachment.download",
              "attachment.remove",
              "customField.definitions",
              "customField.create",
              "customField.getValues",
              "savedView.list",
              "savedView.create",
              "savedView.get",
              "savedView.reorder",
              "sla.listPolicies",
              "sla.createPolicy",
              "sla.get",
              "approval.list",
              "approval.approve",
              "dashboard.list",
              "dashboard.create",
              "dashboard.widgets.create",
              "dashboard.widgets.data",
              "dashboard.get",
              "portfolio.list",
              "portfolio.create",
              "portfolio.addProject",
              "portfolio.get",
              "portfolio.summary",
              "organization.departments",
              "organization.positions",
              "team.list",
              "role.assignments"
            ]
          }
        },
        "id": {
          "type": "string",
          "const": "collaboration"
        },
        "purpose": {
          "type": "string",
          "const": "协作、交接与工时回写"
        },
        "steps": {
          "type": "array",
          "items": {
            "anyOf": [
              {
                "type": "string",
                "const": "project.members"
              },
              {
                "type": "string",
                "const": "workitem.addCollaborator"
              },
              {
                "type": "string",
                "const": "workitem.collaborators"
              },
              {
                "type": "string",
                "const": "workitem.transfer"
              },
              {
                "type": "string",
                "const": "workitem.transfers"
              },
              {
                "type": "string",
                "const": "timeLog.create"
              },
              {
                "type": "string",
                "const": "timeLog.list"
              }
            ]
          }
        }
      },
      "required": [
        "missingTools",
        "id",
        "purpose",
        "steps"
      ],
      "additionalProperties": false
    },
    "T72": {
      "type": "object",
      "properties": {
        "missingTools": {
          "type": "array",
          "items": {
            "type": "string",
            "enum": [
              "workitem.transfer",
              "workitem.addCollaborator",
              "customField.setValues",
              "workflow.list",
              "workflow.addState",
              "workflow.addTransition",
              "workflow.updateTransition",
              "page.revisions",
              "import.get",
              "import.suggestions",
              "workitem.transition",
              "savedView.update",
              "automation.createRule",
              "automation.updateRule",
              "role.assign",
              "organization.assignMember",
              "workitem.link",
              "idea.vote",
              "idea.promote",
              "plan.completeIteration",
              "plan.completeRelease",
              "project.context",
              "workitem.list",
              "workitem.create",
              "workitem.children",
              "workitem.update",
              "workitem.assign",
              "workitem.get",
              "workitem.comment",
              "plan.listIterations",
              "plan.createIteration",
              "plan.getIteration",
              "plan.updateIteration",
              "plan.getRelease",
              "plan.archiveIteration",
              "plan.unarchiveIteration",
              "idea.list",
              "idea.get",
              "idea.update",
              "page.list",
              "page.get",
              "page.update",
              "page.restore",
              "automation.listRules",
              "automation.testRule",
              "automation.listRuns",
              "import.create",
              "import.setMapping",
              "import.dryRun",
              "import.confirm",
              "import.rollback",
              "intake.listForms",
              "intake.listSubmissions",
              "intake.convertSubmission",
              "project.create",
              "member.list",
              "role.list",
              "project.member.add",
              "project.members",
              "project.update",
              "project.get",
              "insight.burnDown",
              "insight.cumulativeFlow",
              "project.report",
              "workflow.states",
              "meta.workflow",
              "todo.list",
              "todo.create",
              "todo.update",
              "focus.blocks",
              "focus.createBlock",
              "focus.recordSession",
              "focus.today",
              "workitem.relations",
              "workitem.unlink",
              "workitem.collaborators",
              "workitem.transfers",
              "timeLog.create",
              "timeLog.list",
              "workitem.addProgressUpdate",
              "workitem.progressUpdates",
              "plan.addMilestoneProgressUpdate",
              "plan.milestoneDetail",
              "attachment.list",
              "attachment.upload",
              "attachment.download",
              "attachment.remove",
              "customField.definitions",
              "customField.create",
              "customField.getValues",
              "savedView.list",
              "savedView.create",
              "savedView.get",
              "savedView.reorder",
              "sla.listPolicies",
              "sla.createPolicy",
              "sla.get",
              "approval.list",
              "approval.approve",
              "dashboard.list",
              "dashboard.create",
              "dashboard.widgets.create",
              "dashboard.widgets.data",
              "dashboard.get",
              "portfolio.list",
              "portfolio.create",
              "portfolio.addProject",
              "portfolio.get",
              "portfolio.summary",
              "organization.departments",
              "organization.positions",
              "team.list",
              "role.assignments"
            ]
          }
        },
        "id": {
          "type": "string",
          "const": "progress"
        },
        "purpose": {
          "type": "string",
          "const": "任务及里程碑进展汇报与复核"
        },
        "steps": {
          "type": "array",
          "items": {
            "anyOf": [
              {
                "type": "string",
                "const": "workitem.get"
              },
              {
                "type": "string",
                "const": "workitem.addProgressUpdate"
              },
              {
                "type": "string",
                "const": "workitem.progressUpdates"
              },
              {
                "type": "string",
                "const": "plan.addMilestoneProgressUpdate"
              },
              {
                "type": "string",
                "const": "plan.milestoneDetail"
              }
            ]
          }
        }
      },
      "required": [
        "missingTools",
        "id",
        "purpose",
        "steps"
      ],
      "additionalProperties": false
    },
    "T73": {
      "type": "object",
      "properties": {
        "missingTools": {
          "type": "array",
          "items": {
            "type": "string",
            "enum": [
              "workitem.transfer",
              "workitem.addCollaborator",
              "customField.setValues",
              "workflow.list",
              "workflow.addState",
              "workflow.addTransition",
              "workflow.updateTransition",
              "page.revisions",
              "import.get",
              "import.suggestions",
              "workitem.transition",
              "savedView.update",
              "automation.createRule",
              "automation.updateRule",
              "role.assign",
              "organization.assignMember",
              "workitem.link",
              "idea.vote",
              "idea.promote",
              "plan.completeIteration",
              "plan.completeRelease",
              "project.context",
              "workitem.list",
              "workitem.create",
              "workitem.children",
              "workitem.update",
              "workitem.assign",
              "workitem.get",
              "workitem.comment",
              "plan.listIterations",
              "plan.createIteration",
              "plan.getIteration",
              "plan.updateIteration",
              "plan.getRelease",
              "plan.archiveIteration",
              "plan.unarchiveIteration",
              "idea.list",
              "idea.get",
              "idea.update",
              "page.list",
              "page.get",
              "page.update",
              "page.restore",
              "automation.listRules",
              "automation.testRule",
              "automation.listRuns",
              "import.create",
              "import.setMapping",
              "import.dryRun",
              "import.confirm",
              "import.rollback",
              "intake.listForms",
              "intake.listSubmissions",
              "intake.convertSubmission",
              "project.create",
              "member.list",
              "role.list",
              "project.member.add",
              "project.members",
              "project.update",
              "project.get",
              "insight.burnDown",
              "insight.cumulativeFlow",
              "project.report",
              "workflow.states",
              "meta.workflow",
              "todo.list",
              "todo.create",
              "todo.update",
              "focus.blocks",
              "focus.createBlock",
              "focus.recordSession",
              "focus.today",
              "workitem.relations",
              "workitem.unlink",
              "workitem.collaborators",
              "workitem.transfers",
              "timeLog.create",
              "timeLog.list",
              "workitem.addProgressUpdate",
              "workitem.progressUpdates",
              "plan.addMilestoneProgressUpdate",
              "plan.milestoneDetail",
              "attachment.list",
              "attachment.upload",
              "attachment.download",
              "attachment.remove",
              "customField.definitions",
              "customField.create",
              "customField.getValues",
              "savedView.list",
              "savedView.create",
              "savedView.get",
              "savedView.reorder",
              "sla.listPolicies",
              "sla.createPolicy",
              "sla.get",
              "approval.list",
              "approval.approve",
              "dashboard.list",
              "dashboard.create",
              "dashboard.widgets.create",
              "dashboard.widgets.data",
              "dashboard.get",
              "portfolio.list",
              "portfolio.create",
              "portfolio.addProject",
              "portfolio.get",
              "portfolio.summary",
              "organization.departments",
              "organization.positions",
              "team.list",
              "role.assignments"
            ]
          }
        },
        "id": {
          "type": "string",
          "const": "attachments"
        },
        "purpose": {
          "type": "string",
          "const": "附件上传、复读、安全下载与移除"
        },
        "steps": {
          "type": "array",
          "items": {
            "anyOf": [
              {
                "type": "string",
                "const": "attachment.list"
              },
              {
                "type": "string",
                "const": "attachment.upload"
              },
              {
                "type": "string",
                "const": "attachment.list"
              },
              {
                "type": "string",
                "const": "attachment.download"
              },
              {
                "type": "string",
                "const": "attachment.remove"
              }
            ]
          }
        }
      },
      "required": [
        "missingTools",
        "id",
        "purpose",
        "steps"
      ],
      "additionalProperties": false
    },
    "T74": {
      "type": "object",
      "properties": {
        "missingTools": {
          "type": "array",
          "items": {
            "type": "string",
            "enum": [
              "workitem.transfer",
              "workitem.addCollaborator",
              "customField.setValues",
              "workflow.list",
              "workflow.addState",
              "workflow.addTransition",
              "workflow.updateTransition",
              "page.revisions",
              "import.get",
              "import.suggestions",
              "workitem.transition",
              "savedView.update",
              "automation.createRule",
              "automation.updateRule",
              "role.assign",
              "organization.assignMember",
              "workitem.link",
              "idea.vote",
              "idea.promote",
              "plan.completeIteration",
              "plan.completeRelease",
              "project.context",
              "workitem.list",
              "workitem.create",
              "workitem.children",
              "workitem.update",
              "workitem.assign",
              "workitem.get",
              "workitem.comment",
              "plan.listIterations",
              "plan.createIteration",
              "plan.getIteration",
              "plan.updateIteration",
              "plan.getRelease",
              "plan.archiveIteration",
              "plan.unarchiveIteration",
              "idea.list",
              "idea.get",
              "idea.update",
              "page.list",
              "page.get",
              "page.update",
              "page.restore",
              "automation.listRules",
              "automation.testRule",
              "automation.listRuns",
              "import.create",
              "import.setMapping",
              "import.dryRun",
              "import.confirm",
              "import.rollback",
              "intake.listForms",
              "intake.listSubmissions",
              "intake.convertSubmission",
              "project.create",
              "member.list",
              "role.list",
              "project.member.add",
              "project.members",
              "project.update",
              "project.get",
              "insight.burnDown",
              "insight.cumulativeFlow",
              "project.report",
              "workflow.states",
              "meta.workflow",
              "todo.list",
              "todo.create",
              "todo.update",
              "focus.blocks",
              "focus.createBlock",
              "focus.recordSession",
              "focus.today",
              "workitem.relations",
              "workitem.unlink",
              "workitem.collaborators",
              "workitem.transfers",
              "timeLog.create",
              "timeLog.list",
              "workitem.addProgressUpdate",
              "workitem.progressUpdates",
              "plan.addMilestoneProgressUpdate",
              "plan.milestoneDetail",
              "attachment.list",
              "attachment.upload",
              "attachment.download",
              "attachment.remove",
              "customField.definitions",
              "customField.create",
              "customField.getValues",
              "savedView.list",
              "savedView.create",
              "savedView.get",
              "savedView.reorder",
              "sla.listPolicies",
              "sla.createPolicy",
              "sla.get",
              "approval.list",
              "approval.approve",
              "dashboard.list",
              "dashboard.create",
              "dashboard.widgets.create",
              "dashboard.widgets.data",
              "dashboard.get",
              "portfolio.list",
              "portfolio.create",
              "portfolio.addProject",
              "portfolio.get",
              "portfolio.summary",
              "organization.departments",
              "organization.positions",
              "team.list",
              "role.assignments"
            ]
          }
        },
        "id": {
          "type": "string",
          "const": "fields"
        },
        "purpose": {
          "type": "string",
          "const": "字段定义、类型校验与带版本的赋值"
        },
        "steps": {
          "type": "array",
          "items": {
            "anyOf": [
              {
                "type": "string",
                "const": "customField.definitions"
              },
              {
                "type": "string",
                "const": "customField.create"
              },
              {
                "type": "string",
                "const": "workitem.get"
              },
              {
                "type": "string",
                "const": "customField.setValues"
              },
              {
                "type": "string",
                "const": "customField.getValues"
              }
            ]
          }
        }
      },
      "required": [
        "missingTools",
        "id",
        "purpose",
        "steps"
      ],
      "additionalProperties": false
    },
    "T75": {
      "type": "object",
      "properties": {
        "missingTools": {
          "type": "array",
          "items": {
            "type": "string",
            "enum": [
              "workitem.transfer",
              "workitem.addCollaborator",
              "customField.setValues",
              "workflow.list",
              "workflow.addState",
              "workflow.addTransition",
              "workflow.updateTransition",
              "page.revisions",
              "import.get",
              "import.suggestions",
              "workitem.transition",
              "savedView.update",
              "automation.createRule",
              "automation.updateRule",
              "role.assign",
              "organization.assignMember",
              "workitem.link",
              "idea.vote",
              "idea.promote",
              "plan.completeIteration",
              "plan.completeRelease",
              "project.context",
              "workitem.list",
              "workitem.create",
              "workitem.children",
              "workitem.update",
              "workitem.assign",
              "workitem.get",
              "workitem.comment",
              "plan.listIterations",
              "plan.createIteration",
              "plan.getIteration",
              "plan.updateIteration",
              "plan.getRelease",
              "plan.archiveIteration",
              "plan.unarchiveIteration",
              "idea.list",
              "idea.get",
              "idea.update",
              "page.list",
              "page.get",
              "page.update",
              "page.restore",
              "automation.listRules",
              "automation.testRule",
              "automation.listRuns",
              "import.create",
              "import.setMapping",
              "import.dryRun",
              "import.confirm",
              "import.rollback",
              "intake.listForms",
              "intake.listSubmissions",
              "intake.convertSubmission",
              "project.create",
              "member.list",
              "role.list",
              "project.member.add",
              "project.members",
              "project.update",
              "project.get",
              "insight.burnDown",
              "insight.cumulativeFlow",
              "project.report",
              "workflow.states",
              "meta.workflow",
              "todo.list",
              "todo.create",
              "todo.update",
              "focus.blocks",
              "focus.createBlock",
              "focus.recordSession",
              "focus.today",
              "workitem.relations",
              "workitem.unlink",
              "workitem.collaborators",
              "workitem.transfers",
              "timeLog.create",
              "timeLog.list",
              "workitem.addProgressUpdate",
              "workitem.progressUpdates",
              "plan.addMilestoneProgressUpdate",
              "plan.milestoneDetail",
              "attachment.list",
              "attachment.upload",
              "attachment.download",
              "attachment.remove",
              "customField.definitions",
              "customField.create",
              "customField.getValues",
              "savedView.list",
              "savedView.create",
              "savedView.get",
              "savedView.reorder",
              "sla.listPolicies",
              "sla.createPolicy",
              "sla.get",
              "approval.list",
              "approval.approve",
              "dashboard.list",
              "dashboard.create",
              "dashboard.widgets.create",
              "dashboard.widgets.data",
              "dashboard.get",
              "portfolio.list",
              "portfolio.create",
              "portfolio.addProject",
              "portfolio.get",
              "portfolio.summary",
              "organization.departments",
              "organization.positions",
              "team.list",
              "role.assignments"
            ]
          }
        },
        "id": {
          "type": "string",
          "const": "views"
        },
        "purpose": {
          "type": "string",
          "const": "保存个人或共享视图、调整与复读"
        },
        "steps": {
          "type": "array",
          "items": {
            "anyOf": [
              {
                "type": "string",
                "const": "savedView.list"
              },
              {
                "type": "string",
                "const": "savedView.create"
              },
              {
                "type": "string",
                "const": "savedView.get"
              },
              {
                "type": "string",
                "const": "savedView.update"
              },
              {
                "type": "string",
                "const": "savedView.reorder"
              },
              {
                "type": "string",
                "const": "savedView.get"
              }
            ]
          }
        }
      },
      "required": [
        "missingTools",
        "id",
        "purpose",
        "steps"
      ],
      "additionalProperties": false
    },
    "T76": {
      "type": "object",
      "properties": {
        "missingTools": {
          "type": "array",
          "items": {
            "type": "string",
            "enum": [
              "workitem.transfer",
              "workitem.addCollaborator",
              "customField.setValues",
              "workflow.list",
              "workflow.addState",
              "workflow.addTransition",
              "workflow.updateTransition",
              "page.revisions",
              "import.get",
              "import.suggestions",
              "workitem.transition",
              "savedView.update",
              "automation.createRule",
              "automation.updateRule",
              "role.assign",
              "organization.assignMember",
              "workitem.link",
              "idea.vote",
              "idea.promote",
              "plan.completeIteration",
              "plan.completeRelease",
              "project.context",
              "workitem.list",
              "workitem.create",
              "workitem.children",
              "workitem.update",
              "workitem.assign",
              "workitem.get",
              "workitem.comment",
              "plan.listIterations",
              "plan.createIteration",
              "plan.getIteration",
              "plan.updateIteration",
              "plan.getRelease",
              "plan.archiveIteration",
              "plan.unarchiveIteration",
              "idea.list",
              "idea.get",
              "idea.update",
              "page.list",
              "page.get",
              "page.update",
              "page.restore",
              "automation.listRules",
              "automation.testRule",
              "automation.listRuns",
              "import.create",
              "import.setMapping",
              "import.dryRun",
              "import.confirm",
              "import.rollback",
              "intake.listForms",
              "intake.listSubmissions",
              "intake.convertSubmission",
              "project.create",
              "member.list",
              "role.list",
              "project.member.add",
              "project.members",
              "project.update",
              "project.get",
              "insight.burnDown",
              "insight.cumulativeFlow",
              "project.report",
              "workflow.states",
              "meta.workflow",
              "todo.list",
              "todo.create",
              "todo.update",
              "focus.blocks",
              "focus.createBlock",
              "focus.recordSession",
              "focus.today",
              "workitem.relations",
              "workitem.unlink",
              "workitem.collaborators",
              "workitem.transfers",
              "timeLog.create",
              "timeLog.list",
              "workitem.addProgressUpdate",
              "workitem.progressUpdates",
              "plan.addMilestoneProgressUpdate",
              "plan.milestoneDetail",
              "attachment.list",
              "attachment.upload",
              "attachment.download",
              "attachment.remove",
              "customField.definitions",
              "customField.create",
              "customField.getValues",
              "savedView.list",
              "savedView.create",
              "savedView.get",
              "savedView.reorder",
              "sla.listPolicies",
              "sla.createPolicy",
              "sla.get",
              "approval.list",
              "approval.approve",
              "dashboard.list",
              "dashboard.create",
              "dashboard.widgets.create",
              "dashboard.widgets.data",
              "dashboard.get",
              "portfolio.list",
              "portfolio.create",
              "portfolio.addProject",
              "portfolio.get",
              "portfolio.summary",
              "organization.departments",
              "organization.positions",
              "team.list",
              "role.assignments"
            ]
          }
        },
        "id": {
          "type": "string",
          "const": "slaApproval"
        },
        "purpose": {
          "type": "string",
          "const": "SLA策略与时钟、审批决策与最终流转确认"
        },
        "steps": {
          "type": "array",
          "items": {
            "anyOf": [
              {
                "type": "string",
                "const": "sla.listPolicies"
              },
              {
                "type": "string",
                "const": "sla.createPolicy"
              },
              {
                "type": "string",
                "const": "sla.get"
              },
              {
                "type": "string",
                "const": "approval.list"
              },
              {
                "type": "string",
                "const": "approval.approve"
              },
              {
                "type": "string",
                "const": "workitem.get"
              }
            ]
          }
        }
      },
      "required": [
        "missingTools",
        "id",
        "purpose",
        "steps"
      ],
      "additionalProperties": false
    },
    "T77": {
      "type": "object",
      "properties": {
        "missingTools": {
          "type": "array",
          "items": {
            "type": "string",
            "enum": [
              "workitem.transfer",
              "workitem.addCollaborator",
              "customField.setValues",
              "workflow.list",
              "workflow.addState",
              "workflow.addTransition",
              "workflow.updateTransition",
              "page.revisions",
              "import.get",
              "import.suggestions",
              "workitem.transition",
              "savedView.update",
              "automation.createRule",
              "automation.updateRule",
              "role.assign",
              "organization.assignMember",
              "workitem.link",
              "idea.vote",
              "idea.promote",
              "plan.completeIteration",
              "plan.completeRelease",
              "project.context",
              "workitem.list",
              "workitem.create",
              "workitem.children",
              "workitem.update",
              "workitem.assign",
              "workitem.get",
              "workitem.comment",
              "plan.listIterations",
              "plan.createIteration",
              "plan.getIteration",
              "plan.updateIteration",
              "plan.getRelease",
              "plan.archiveIteration",
              "plan.unarchiveIteration",
              "idea.list",
              "idea.get",
              "idea.update",
              "page.list",
              "page.get",
              "page.update",
              "page.restore",
              "automation.listRules",
              "automation.testRule",
              "automation.listRuns",
              "import.create",
              "import.setMapping",
              "import.dryRun",
              "import.confirm",
              "import.rollback",
              "intake.listForms",
              "intake.listSubmissions",
              "intake.convertSubmission",
              "project.create",
              "member.list",
              "role.list",
              "project.member.add",
              "project.members",
              "project.update",
              "project.get",
              "insight.burnDown",
              "insight.cumulativeFlow",
              "project.report",
              "workflow.states",
              "meta.workflow",
              "todo.list",
              "todo.create",
              "todo.update",
              "focus.blocks",
              "focus.createBlock",
              "focus.recordSession",
              "focus.today",
              "workitem.relations",
              "workitem.unlink",
              "workitem.collaborators",
              "workitem.transfers",
              "timeLog.create",
              "timeLog.list",
              "workitem.addProgressUpdate",
              "workitem.progressUpdates",
              "plan.addMilestoneProgressUpdate",
              "plan.milestoneDetail",
              "attachment.list",
              "attachment.upload",
              "attachment.download",
              "attachment.remove",
              "customField.definitions",
              "customField.create",
              "customField.getValues",
              "savedView.list",
              "savedView.create",
              "savedView.get",
              "savedView.reorder",
              "sla.listPolicies",
              "sla.createPolicy",
              "sla.get",
              "approval.list",
              "approval.approve",
              "dashboard.list",
              "dashboard.create",
              "dashboard.widgets.create",
              "dashboard.widgets.data",
              "dashboard.get",
              "portfolio.list",
              "portfolio.create",
              "portfolio.addProject",
              "portfolio.get",
              "portfolio.summary",
              "organization.departments",
              "organization.positions",
              "team.list",
              "role.assignments"
            ]
          }
        },
        "id": {
          "type": "string",
          "const": "dashboards"
        },
        "purpose": {
          "type": "string",
          "const": "仪表盘配置与组件数据验证"
        },
        "steps": {
          "type": "array",
          "items": {
            "anyOf": [
              {
                "type": "string",
                "const": "dashboard.list"
              },
              {
                "type": "string",
                "const": "dashboard.create"
              },
              {
                "type": "string",
                "const": "dashboard.widgets.create"
              },
              {
                "type": "string",
                "const": "dashboard.widgets.data"
              },
              {
                "type": "string",
                "const": "dashboard.get"
              }
            ]
          }
        }
      },
      "required": [
        "missingTools",
        "id",
        "purpose",
        "steps"
      ],
      "additionalProperties": false
    },
    "T78": {
      "type": "object",
      "properties": {
        "missingTools": {
          "type": "array",
          "items": {
            "type": "string",
            "enum": [
              "workitem.transfer",
              "workitem.addCollaborator",
              "customField.setValues",
              "workflow.list",
              "workflow.addState",
              "workflow.addTransition",
              "workflow.updateTransition",
              "page.revisions",
              "import.get",
              "import.suggestions",
              "workitem.transition",
              "savedView.update",
              "automation.createRule",
              "automation.updateRule",
              "role.assign",
              "organization.assignMember",
              "workitem.link",
              "idea.vote",
              "idea.promote",
              "plan.completeIteration",
              "plan.completeRelease",
              "project.context",
              "workitem.list",
              "workitem.create",
              "workitem.children",
              "workitem.update",
              "workitem.assign",
              "workitem.get",
              "workitem.comment",
              "plan.listIterations",
              "plan.createIteration",
              "plan.getIteration",
              "plan.updateIteration",
              "plan.getRelease",
              "plan.archiveIteration",
              "plan.unarchiveIteration",
              "idea.list",
              "idea.get",
              "idea.update",
              "page.list",
              "page.get",
              "page.update",
              "page.restore",
              "automation.listRules",
              "automation.testRule",
              "automation.listRuns",
              "import.create",
              "import.setMapping",
              "import.dryRun",
              "import.confirm",
              "import.rollback",
              "intake.listForms",
              "intake.listSubmissions",
              "intake.convertSubmission",
              "project.create",
              "member.list",
              "role.list",
              "project.member.add",
              "project.members",
              "project.update",
              "project.get",
              "insight.burnDown",
              "insight.cumulativeFlow",
              "project.report",
              "workflow.states",
              "meta.workflow",
              "todo.list",
              "todo.create",
              "todo.update",
              "focus.blocks",
              "focus.createBlock",
              "focus.recordSession",
              "focus.today",
              "workitem.relations",
              "workitem.unlink",
              "workitem.collaborators",
              "workitem.transfers",
              "timeLog.create",
              "timeLog.list",
              "workitem.addProgressUpdate",
              "workitem.progressUpdates",
              "plan.addMilestoneProgressUpdate",
              "plan.milestoneDetail",
              "attachment.list",
              "attachment.upload",
              "attachment.download",
              "attachment.remove",
              "customField.definitions",
              "customField.create",
              "customField.getValues",
              "savedView.list",
              "savedView.create",
              "savedView.get",
              "savedView.reorder",
              "sla.listPolicies",
              "sla.createPolicy",
              "sla.get",
              "approval.list",
              "approval.approve",
              "dashboard.list",
              "dashboard.create",
              "dashboard.widgets.create",
              "dashboard.widgets.data",
              "dashboard.get",
              "portfolio.list",
              "portfolio.create",
              "portfolio.addProject",
              "portfolio.get",
              "portfolio.summary",
              "organization.departments",
              "organization.positions",
              "team.list",
              "role.assignments"
            ]
          }
        },
        "id": {
          "type": "string",
          "const": "portfolios"
        },
        "purpose": {
          "type": "string",
          "const": "项目组合、项目关联与汇总"
        },
        "steps": {
          "type": "array",
          "items": {
            "anyOf": [
              {
                "type": "string",
                "const": "portfolio.list"
              },
              {
                "type": "string",
                "const": "portfolio.create"
              },
              {
                "type": "string",
                "const": "portfolio.addProject"
              },
              {
                "type": "string",
                "const": "portfolio.get"
              },
              {
                "type": "string",
                "const": "portfolio.summary"
              }
            ]
          }
        }
      },
      "required": [
        "missingTools",
        "id",
        "purpose",
        "steps"
      ],
      "additionalProperties": false
    },
    "T79": {
      "type": "object",
      "properties": {
        "missingTools": {
          "type": "array",
          "items": {
            "type": "string",
            "enum": [
              "workitem.transfer",
              "workitem.addCollaborator",
              "customField.setValues",
              "workflow.list",
              "workflow.addState",
              "workflow.addTransition",
              "workflow.updateTransition",
              "page.revisions",
              "import.get",
              "import.suggestions",
              "workitem.transition",
              "savedView.update",
              "automation.createRule",
              "automation.updateRule",
              "role.assign",
              "organization.assignMember",
              "workitem.link",
              "idea.vote",
              "idea.promote",
              "plan.completeIteration",
              "plan.completeRelease",
              "project.context",
              "workitem.list",
              "workitem.create",
              "workitem.children",
              "workitem.update",
              "workitem.assign",
              "workitem.get",
              "workitem.comment",
              "plan.listIterations",
              "plan.createIteration",
              "plan.getIteration",
              "plan.updateIteration",
              "plan.getRelease",
              "plan.archiveIteration",
              "plan.unarchiveIteration",
              "idea.list",
              "idea.get",
              "idea.update",
              "page.list",
              "page.get",
              "page.update",
              "page.restore",
              "automation.listRules",
              "automation.testRule",
              "automation.listRuns",
              "import.create",
              "import.setMapping",
              "import.dryRun",
              "import.confirm",
              "import.rollback",
              "intake.listForms",
              "intake.listSubmissions",
              "intake.convertSubmission",
              "project.create",
              "member.list",
              "role.list",
              "project.member.add",
              "project.members",
              "project.update",
              "project.get",
              "insight.burnDown",
              "insight.cumulativeFlow",
              "project.report",
              "workflow.states",
              "meta.workflow",
              "todo.list",
              "todo.create",
              "todo.update",
              "focus.blocks",
              "focus.createBlock",
              "focus.recordSession",
              "focus.today",
              "workitem.relations",
              "workitem.unlink",
              "workitem.collaborators",
              "workitem.transfers",
              "timeLog.create",
              "timeLog.list",
              "workitem.addProgressUpdate",
              "workitem.progressUpdates",
              "plan.addMilestoneProgressUpdate",
              "plan.milestoneDetail",
              "attachment.list",
              "attachment.upload",
              "attachment.download",
              "attachment.remove",
              "customField.definitions",
              "customField.create",
              "customField.getValues",
              "savedView.list",
              "savedView.create",
              "savedView.get",
              "savedView.reorder",
              "sla.listPolicies",
              "sla.createPolicy",
              "sla.get",
              "approval.list",
              "approval.approve",
              "dashboard.list",
              "dashboard.create",
              "dashboard.widgets.create",
              "dashboard.widgets.data",
              "dashboard.get",
              "portfolio.list",
              "portfolio.create",
              "portfolio.addProject",
              "portfolio.get",
              "portfolio.summary",
              "organization.departments",
              "organization.positions",
              "team.list",
              "role.assignments"
            ]
          }
        },
        "id": {
          "type": "string",
          "const": "organization"
        },
        "purpose": {
          "type": "string",
          "const": "组织归属、团队与角色范围管理"
        },
        "steps": {
          "type": "array",
          "items": {
            "anyOf": [
              {
                "type": "string",
                "const": "organization.departments"
              },
              {
                "type": "string",
                "const": "organization.positions"
              },
              {
                "type": "string",
                "const": "member.list"
              },
              {
                "type": "string",
                "const": "organization.assignMember"
              },
              {
                "type": "string",
                "const": "team.list"
              },
              {
                "type": "string",
                "const": "role.list"
              },
              {
                "type": "string",
                "const": "role.assignments"
              },
              {
                "type": "string",
                "const": "role.assign"
              },
              {
                "type": "string",
                "const": "role.assignments"
              }
            ]
          }
        }
      },
      "required": [
        "missingTools",
        "id",
        "purpose",
        "steps"
      ],
      "additionalProperties": false
    },
    "T80": {
      "type": "object",
      "properties": {
        "humanAuthentication": {
          "type": "string"
        },
        "systemMaintenance": {
          "type": "string"
        },
        "asynchronous": {
          "type": "string"
        },
        "protocol": {
          "type": "string"
        }
      },
      "required": [
        "humanAuthentication",
        "systemMaintenance",
        "asynchronous",
        "protocol"
      ],
      "additionalProperties": false
    },
    "T81": {
      "type": "object",
      "properties": {
        "available": {
          "type": "boolean"
        },
        "reason": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "description": {
          "type": "string"
        },
        "kind": {
          "type": "string",
          "enum": [
            "read",
            "write"
          ]
        },
        "inputSchema": {
          "type": "object",
          "additionalProperties": {
            "$ref": "#/$defs/JsonValue"
          }
        },
        "outputSchema": {
          "type": "object",
          "additionalProperties": {
            "$ref": "#/$defs/JsonValue"
          }
        }
      },
      "required": [
        "available",
        "reason",
        "name",
        "description",
        "kind",
        "inputSchema",
        "outputSchema"
      ],
      "additionalProperties": false
    },
    "T82": {
      "type": "object",
      "properties": {
        "group": {
          "type": "string"
        },
        "permissions": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T83"
          }
        }
      },
      "required": [
        "group",
        "permissions"
      ],
      "additionalProperties": false
    },
    "T83": {
      "type": "object",
      "properties": {
        "key": {
          "type": "string"
        },
        "group": {
          "type": "string"
        },
        "description": {
          "type": "string"
        }
      },
      "required": [
        "key",
        "group",
        "description"
      ],
      "additionalProperties": false
    },
    "T84": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "key": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "isBuiltin": {
          "type": "boolean"
        },
        "isSystem": {
          "type": "boolean"
        },
        "permissionKeys": {
          "type": "array",
          "items": {
            "type": "string"
          }
        }
      },
      "required": [
        "id",
        "key",
        "name",
        "isBuiltin",
        "isSystem",
        "permissionKeys"
      ],
      "additionalProperties": false
    },
    "T85": {
      "type": "object",
      "properties": {
        "ok": {
          "type": "boolean"
        }
      },
      "required": [
        "ok"
      ],
      "additionalProperties": false
    },
    "T86": {
      "type": "object",
      "properties": {
        "scopeType": {
          "type": "string",
          "const": "DEPARTMENT"
        },
        "scopes": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T87"
          }
        }
      },
      "required": [
        "scopeType",
        "scopes"
      ],
      "additionalProperties": false
    },
    "T87": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "name": {
          "type": "string"
        }
      },
      "required": [
        "id",
        "name"
      ],
      "additionalProperties": false
    },
    "T88": {
      "type": "object",
      "properties": {
        "scopeType": {
          "type": "string",
          "const": "TEAM"
        },
        "scopes": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T89"
          }
        }
      },
      "required": [
        "scopeType",
        "scopes"
      ],
      "additionalProperties": false
    },
    "T89": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "name": {
          "type": "string"
        }
      },
      "required": [
        "id",
        "name"
      ],
      "additionalProperties": false
    },
    "T90": {
      "type": "object",
      "properties": {
        "scopeType": {
          "type": "string",
          "const": "PROJECT"
        },
        "scopes": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T91"
          }
        }
      },
      "required": [
        "scopeType",
        "scopes"
      ],
      "additionalProperties": false
    },
    "T91": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "name": {
          "type": "string"
        }
      },
      "required": [
        "id",
        "name"
      ],
      "additionalProperties": false
    },
    "T92": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "memberId": {
          "type": "string"
        },
        "roleId": {
          "type": "string"
        },
        "roleKey": {
          "type": "string"
        },
        "roleName": {
          "type": "string"
        },
        "roleIsBuiltin": {
          "type": "boolean"
        },
        "scopeType": {
          "type": "string",
          "enum": [
            "PROJECT",
            "TEAM",
            "DEPARTMENT",
            "ORG"
          ]
        },
        "scopeId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "scopeName": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        }
      },
      "required": [
        "id",
        "memberId",
        "roleId",
        "roleKey",
        "roleName",
        "roleIsBuiltin",
        "scopeType",
        "scopeId",
        "scopeName"
      ],
      "additionalProperties": false
    },
    "T93": {
      "type": "object",
      "properties": {
        "departments": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T94"
          }
        },
        "metric": {
          "type": "string"
        }
      },
      "required": [
        "departments",
        "metric"
      ],
      "additionalProperties": false
    },
    "T94": {
      "type": "object",
      "properties": {
        "memberCount": {
          "type": "integer"
        },
        "id": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "parentId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "sortOrder": {
          "type": "integer"
        },
        "archivedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "memberCount",
        "id",
        "name",
        "parentId",
        "sortOrder",
        "archivedAt",
        "createdAt"
      ],
      "additionalProperties": false
    },
    "T95": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "parentId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "sortOrder": {
          "type": "integer"
        },
        "archivedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        }
      },
      "required": [
        "id",
        "name",
        "createdAt",
        "parentId",
        "sortOrder",
        "archivedAt"
      ],
      "additionalProperties": false
    },
    "T96": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "parentId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "sortOrder": {
          "type": "integer"
        },
        "archivedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "name",
        "parentId",
        "sortOrder",
        "archivedAt",
        "createdAt"
      ],
      "additionalProperties": false
    },
    "T97": {
      "type": "object",
      "properties": {
        "positions": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T98"
          }
        }
      },
      "required": [
        "positions"
      ],
      "additionalProperties": false
    },
    "T98": {
      "type": "object",
      "properties": {
        "memberCount": {
          "type": "integer"
        },
        "id": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "code": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "departmentId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "description": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "sortOrder": {
          "type": "integer"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "departmentName": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        }
      },
      "required": [
        "memberCount",
        "id",
        "name",
        "code",
        "departmentId",
        "description",
        "sortOrder",
        "createdAt",
        "departmentName"
      ],
      "additionalProperties": false
    },
    "T99": {
      "type": "object",
      "properties": {
        "code": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "id": {
          "type": "string"
        },
        "description": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "name": {
          "type": "string"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "sortOrder": {
          "type": "integer"
        },
        "archivedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "departmentId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        }
      },
      "required": [
        "code",
        "id",
        "description",
        "name",
        "createdAt",
        "sortOrder",
        "archivedAt",
        "departmentId"
      ],
      "additionalProperties": false
    },
    "T100": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "code": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "departmentId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "description": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "sortOrder": {
          "type": "integer"
        },
        "archivedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "name",
        "code",
        "departmentId",
        "description",
        "sortOrder",
        "archivedAt",
        "createdAt"
      ],
      "additionalProperties": false
    },
    "T101": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "departmentId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "positionId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        }
      },
      "required": [
        "id",
        "departmentId",
        "positionId"
      ],
      "additionalProperties": false
    },
    "T102": {
      "type": "object",
      "properties": {
        "ok": {
          "type": "boolean"
        },
        "kind": {
          "type": "string",
          "enum": [
            "COMPANY",
            "OPC"
          ]
        },
        "departmentsCreated": {
          "type": "number"
        },
        "departmentCount": {
          "type": "integer"
        }
      },
      "required": [
        "ok",
        "kind",
        "departmentsCreated",
        "departmentCount"
      ],
      "additionalProperties": false
    },
    "T103": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "parentId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "sortOrder": {
          "type": "integer"
        },
        "memberCount": {
          "type": "integer"
        },
        "children": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T103"
          }
        }
      },
      "required": [
        "id",
        "name",
        "parentId",
        "sortOrder",
        "memberCount",
        "children"
      ],
      "additionalProperties": false
    },
    "T104": {
      "type": "object",
      "properties": {
        "teamIds": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "members": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T105"
          }
        }
      },
      "required": [
        "teamIds",
        "members"
      ],
      "additionalProperties": false
    },
    "T105": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "username": {
          "type": "string"
        },
        "roles": {
          "type": "array",
          "items": {
            "type": "string"
          }
        }
      },
      "required": [
        "id",
        "name",
        "username",
        "roles"
      ],
      "additionalProperties": false
    },
    "T106": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "parentId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "sortOrder": {
          "type": "integer"
        },
        "archivedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        }
      },
      "required": [
        "id",
        "name",
        "parentId",
        "sortOrder",
        "archivedAt"
      ],
      "additionalProperties": false
    },
    "T107": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "parentId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "sortOrder": {
          "type": "integer"
        },
        "archivedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        }
      },
      "required": [
        "id",
        "name",
        "parentId",
        "sortOrder",
        "archivedAt"
      ],
      "additionalProperties": false
    },
    "T108": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "workItemId": {
          "type": "string"
        },
        "memberId": {
          "type": "string"
        },
        "minutes": {
          "type": "number"
        },
        "loggedDate": {
          "type": "string"
        },
        "note": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "workItemId",
        "memberId",
        "minutes",
        "loggedDate",
        "note",
        "createdAt"
      ],
      "additionalProperties": false
    },
    "T109": {
      "type": "object",
      "properties": {
        "collaborators": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T10"
          }
        }
      },
      "required": [
        "collaborators"
      ],
      "additionalProperties": false
    },
    "T110": {
      "type": "object",
      "properties": {
        "watchers": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T14"
          }
        }
      },
      "required": [
        "watchers"
      ],
      "additionalProperties": false
    },
    "T111": {
      "type": "object",
      "properties": {
        "timeLogs": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T112"
          }
        }
      },
      "required": [
        "timeLogs"
      ],
      "additionalProperties": false
    },
    "T112": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "workItemId": {
          "type": "string"
        },
        "memberId": {
          "type": "string"
        },
        "minutes": {
          "type": "number"
        },
        "loggedDate": {
          "type": "string"
        },
        "note": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "workItemId",
        "memberId",
        "minutes",
        "loggedDate",
        "note",
        "createdAt"
      ],
      "additionalProperties": false
    },
    "T113": {
      "type": "object",
      "properties": {
        "workItemId": {
          "type": "string"
        },
        "id": {
          "type": "string"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "memberId": {
          "type": "string"
        },
        "minutes": {
          "type": "number"
        },
        "loggedDate": {
          "type": "string"
        },
        "note": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        }
      },
      "required": [
        "workItemId",
        "id",
        "createdAt",
        "memberId",
        "minutes",
        "loggedDate",
        "note"
      ],
      "additionalProperties": false
    },
    "T114": {
      "type": "object",
      "properties": {
        "links": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T115"
          }
        }
      },
      "required": [
        "links"
      ],
      "additionalProperties": false
    },
    "T115": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "direction": {
          "type": "string"
        },
        "target": {
          "$ref": "#/$defs/T116"
        }
      },
      "required": [
        "id",
        "direction",
        "target"
      ],
      "additionalProperties": false
    },
    "T116": {
      "type": "object",
      "properties": {
        "type": {
          "type": "string",
          "enum": [
            "PAGE",
            "WORK_ITEM",
            "MILESTONE",
            "IDEA",
            "ITERATION"
          ]
        },
        "id": {
          "type": "string"
        },
        "title": {
          "type": "string"
        },
        "key": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        }
      },
      "required": [
        "type",
        "id",
        "title",
        "key"
      ],
      "additionalProperties": false
    },
    "T117": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "direction": {
          "type": "string"
        },
        "target": {
          "$ref": "#/$defs/T116"
        }
      },
      "required": [
        "id",
        "direction",
        "target"
      ],
      "additionalProperties": false
    },
    "T118": {
      "type": "object",
      "properties": {
        "memberId": {
          "type": "string"
        },
        "theme": {
          "type": "string"
        },
        "locale": {
          "type": "string"
        },
        "timezone": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "density": {
          "type": "string"
        },
        "updatedAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "memberId",
        "theme",
        "locale",
        "timezone",
        "density",
        "updatedAt"
      ],
      "additionalProperties": false
    },
    "T119": {
      "type": "object",
      "properties": {
        "policies": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T120"
          }
        }
      },
      "required": [
        "policies"
      ],
      "additionalProperties": false
    },
    "T120": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "projectId": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "enabled": {
          "type": "boolean"
        },
        "priority": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "severity": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "type": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "responseMinutes": {
          "type": "integer"
        },
        "resolveMinutes": {
          "type": "integer"
        },
        "escalateAfterMinutes": {
          "type": "integer"
        },
        "escalateRoles": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "calendar": {
          "$ref": "#/$defs/JsonValue"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "updatedAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "projectId",
        "name",
        "enabled",
        "priority",
        "severity",
        "type",
        "responseMinutes",
        "resolveMinutes",
        "escalateAfterMinutes",
        "escalateRoles",
        "calendar",
        "createdAt",
        "updatedAt"
      ],
      "additionalProperties": false
    },
    "T121": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "$ref": "#/$defs/T122"
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "T122": {
      "type": "object",
      "properties": {
        "type": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "projectId": {
          "type": "string"
        },
        "id": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "updatedAt": {
          "type": "string",
          "format": "date-time"
        },
        "priority": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "severity": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "enabled": {
          "type": "boolean"
        },
        "responseMinutes": {
          "type": "integer"
        },
        "resolveMinutes": {
          "type": "integer"
        },
        "escalateAfterMinutes": {
          "type": "integer"
        },
        "escalateRoles": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "calendar": {
          "$ref": "#/$defs/JsonValue"
        }
      },
      "required": [
        "type",
        "projectId",
        "id",
        "name",
        "createdAt",
        "updatedAt",
        "priority",
        "severity",
        "enabled",
        "responseMinutes",
        "resolveMinutes",
        "escalateAfterMinutes",
        "escalateRoles",
        "calendar"
      ],
      "additionalProperties": false
    },
    "T123": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "projectId": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "enabled": {
          "type": "boolean"
        },
        "priority": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "severity": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "type": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "responseMinutes": {
          "type": "integer"
        },
        "resolveMinutes": {
          "type": "integer"
        },
        "escalateAfterMinutes": {
          "type": "integer"
        },
        "escalateRoles": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "calendar": {
          "$ref": "#/$defs/JsonValue"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "updatedAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "projectId",
        "name",
        "enabled",
        "priority",
        "severity",
        "type",
        "responseMinutes",
        "resolveMinutes",
        "escalateAfterMinutes",
        "escalateRoles",
        "calendar",
        "createdAt",
        "updatedAt"
      ],
      "additionalProperties": false
    },
    "T124": {
      "type": "object",
      "properties": {
        "ok": {
          "type": "boolean"
        }
      },
      "required": [
        "ok"
      ],
      "additionalProperties": false
    },
    "T125": {
      "type": "object",
      "properties": {
        "items": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T126"
          }
        },
        "total": {
          "type": "integer"
        },
        "page": {
          "type": "integer"
        },
        "pageSize": {
          "type": "integer"
        }
      },
      "required": [
        "items",
        "total",
        "page",
        "pageSize"
      ],
      "additionalProperties": false
    },
    "T126": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "projectId": {
          "type": "string"
        },
        "title": {
          "type": "string"
        },
        "description": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "status": {
          "type": "string"
        },
        "submittedByMemberId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "submitterDisplay": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "promotedWorkItemId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "score": {
          "type": "string"
        },
        "deletedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "updatedAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "projectId",
        "title",
        "description",
        "status",
        "submittedByMemberId",
        "submitterDisplay",
        "promotedWorkItemId",
        "score",
        "deletedAt",
        "createdAt",
        "updatedAt"
      ],
      "additionalProperties": false
    },
    "T127": {
      "type": "object",
      "properties": {
        "votes": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T128"
          }
        },
        "voteCount": {
          "type": "integer"
        },
        "id": {
          "type": "string"
        },
        "projectId": {
          "type": "string"
        },
        "title": {
          "type": "string"
        },
        "description": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "status": {
          "type": "string"
        },
        "submittedByMemberId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "submitterDisplay": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "promotedWorkItemId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "score": {
          "type": "string"
        },
        "deletedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "updatedAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "votes",
        "voteCount",
        "id",
        "projectId",
        "title",
        "description",
        "status",
        "submittedByMemberId",
        "submitterDisplay",
        "promotedWorkItemId",
        "score",
        "deletedAt",
        "createdAt",
        "updatedAt"
      ],
      "additionalProperties": false
    },
    "T128": {
      "type": "object",
      "properties": {
        "ideaId": {
          "type": "string"
        },
        "memberId": {
          "type": "string"
        },
        "weight": {
          "type": "number"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "ideaId",
        "memberId",
        "weight",
        "createdAt"
      ],
      "additionalProperties": false
    },
    "T129": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "projectId": {
          "type": "string"
        },
        "title": {
          "type": "string"
        },
        "description": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "status": {
          "type": "string"
        },
        "submittedByMemberId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "submitterDisplay": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "promotedWorkItemId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "score": {
          "type": "string"
        },
        "deletedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "updatedAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "projectId",
        "title",
        "description",
        "status",
        "submittedByMemberId",
        "submitterDisplay",
        "promotedWorkItemId",
        "score",
        "deletedAt",
        "createdAt",
        "updatedAt"
      ],
      "additionalProperties": false
    },
    "T130": {
      "type": "object",
      "properties": {
        "ok": {
          "type": "boolean"
        }
      },
      "required": [
        "ok"
      ],
      "additionalProperties": false
    },
    "T131": {
      "type": "object",
      "properties": {
        "revisions": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T47"
          }
        }
      },
      "required": [
        "revisions"
      ],
      "additionalProperties": false
    },
    "T132": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "$ref": "#/$defs/T133"
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "T133": {
      "type": "object",
      "properties": {
        "revisionNo": {
          "type": "integer"
        },
        "id": {
          "type": "string"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "authorId": {
          "type": "string"
        },
        "pageId": {
          "type": "string"
        },
        "content": {
          "type": "string"
        },
        "changeSummary": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        }
      },
      "required": [
        "revisionNo",
        "id",
        "createdAt",
        "authorId",
        "pageId",
        "content",
        "changeSummary"
      ],
      "additionalProperties": false
    },
    "T134": {
      "type": "object",
      "properties": {
        "permissions": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T50"
          }
        }
      },
      "required": [
        "permissions"
      ],
      "additionalProperties": false
    },
    "T135": {
      "type": "object",
      "properties": {
        "permissions": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T50"
          }
        }
      },
      "required": [
        "permissions"
      ],
      "additionalProperties": false
    },
    "T136": {
      "type": "object",
      "properties": {
        "attachmentId": {
          "type": "string"
        },
        "originalName": {
          "type": "string"
        },
        "mimeType": {
          "type": "string"
        },
        "sizeBytes": {
          "type": "integer"
        },
        "contentBase64": {
          "type": "string"
        }
      },
      "required": [
        "attachmentId",
        "originalName",
        "mimeType",
        "sizeBytes",
        "contentBase64"
      ],
      "additionalProperties": false
    },
    "T137": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "targetType": {
          "type": "string"
        },
        "targetId": {
          "type": "string"
        },
        "originalName": {
          "type": "string"
        },
        "mimeType": {
          "type": "string"
        },
        "sizeBytes": {
          "type": "integer"
        },
        "uploaderId": {
          "type": "string"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "downloadPath": {
          "type": "string"
        }
      },
      "required": [
        "id",
        "targetType",
        "targetId",
        "originalName",
        "mimeType",
        "sizeBytes",
        "uploaderId",
        "createdAt",
        "downloadPath"
      ],
      "additionalProperties": false
    },
    "T138": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "projectId": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "enabled": {
          "type": "boolean"
        },
        "trigger": {
          "type": "string"
        },
        "conditions": {
          "$ref": "#/$defs/JsonValue"
        },
        "actions": {
          "$ref": "#/$defs/JsonValue"
        },
        "scheduleCron": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "scheduleTimezone": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "lastScheduledAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "scheduleState": {
          "$ref": "#/$defs/JsonValue"
        },
        "createdBy": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "updatedAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "projectId",
        "name",
        "enabled",
        "trigger",
        "conditions",
        "actions",
        "scheduleCron",
        "scheduleTimezone",
        "lastScheduledAt",
        "scheduleState",
        "createdBy",
        "createdAt",
        "updatedAt"
      ],
      "additionalProperties": false
    },
    "T139": {
      "type": "object",
      "properties": {
        "ok": {
          "type": "boolean"
        }
      },
      "required": [
        "ok"
      ],
      "additionalProperties": false
    },
    "T140": {
      "type": "object",
      "properties": {
        "matched": {
          "type": "boolean"
        }
      },
      "required": [
        "matched"
      ],
      "additionalProperties": false
    },
    "T141": {
      "type": "object",
      "properties": {
        "memberId": {
          "type": "string"
        },
        "categoryPrefs": {
          "$ref": "#/$defs/JsonValue"
        },
        "dndStart": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "dndEnd": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "dndTimezone": {
          "type": "string"
        },
        "digestFrequency": {
          "type": "string"
        },
        "updatedAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "memberId",
        "categoryPrefs",
        "dndStart",
        "dndEnd",
        "dndTimezone",
        "digestFrequency",
        "updatedAt"
      ],
      "additionalProperties": false
    },
    "T142": {
      "type": "object",
      "properties": {
        "announcements": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T143"
          }
        }
      },
      "required": [
        "announcements"
      ],
      "additionalProperties": false
    },
    "T143": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "authorId": {
          "type": "string"
        },
        "title": {
          "type": "string"
        },
        "body": {
          "type": "string"
        },
        "severity": {
          "type": "string"
        },
        "audience": {
          "$ref": "#/$defs/JsonValue"
        },
        "deliveredCount": {
          "type": "integer"
        },
        "revokedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "authorId",
        "title",
        "body",
        "severity",
        "audience",
        "deliveredCount",
        "revokedAt",
        "createdAt"
      ],
      "additionalProperties": false
    },
    "T144": {
      "type": "object",
      "properties": {
        "forms": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T145"
          }
        }
      },
      "required": [
        "forms"
      ],
      "additionalProperties": false
    },
    "T145": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "projectId": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "schema": {
          "$ref": "#/$defs/JsonValue"
        },
        "isActive": {
          "type": "boolean"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "projectId",
        "name",
        "schema",
        "isActive",
        "createdAt"
      ],
      "additionalProperties": false
    },
    "T146": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "$ref": "#/$defs/T147"
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "T147": {
      "type": "object",
      "properties": {
        "form": {
          "$ref": "#/$defs/T148"
        }
      },
      "required": [
        "form"
      ],
      "additionalProperties": false
    },
    "T148": {
      "type": "object",
      "properties": {
        "projectId": {
          "type": "string"
        },
        "id": {
          "type": "string"
        },
        "schema": {
          "$ref": "#/$defs/JsonValue"
        },
        "name": {
          "type": "string"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "isActive": {
          "type": "boolean"
        }
      },
      "required": [
        "projectId",
        "id",
        "schema",
        "name",
        "createdAt",
        "isActive"
      ],
      "additionalProperties": false
    },
    "T149": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "projectId": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "schema": {
          "$ref": "#/$defs/JsonValue"
        },
        "isActive": {
          "type": "boolean"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "projectId",
        "name",
        "schema",
        "isActive",
        "createdAt"
      ],
      "additionalProperties": false
    },
    "T150": {
      "type": "object",
      "properties": {
        "items": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T151"
          }
        },
        "total": {
          "type": "integer"
        }
      },
      "required": [
        "items",
        "total"
      ],
      "additionalProperties": false
    },
    "T151": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "formId": {
          "type": "string"
        },
        "payload": {
          "$ref": "#/$defs/JsonValue"
        },
        "status": {
          "type": "string"
        },
        "convertedIdeaId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "formName": {
          "type": "string"
        }
      },
      "required": [
        "id",
        "formId",
        "payload",
        "status",
        "convertedIdeaId",
        "createdAt",
        "formName"
      ],
      "additionalProperties": false
    },
    "T152": {
      "type": "object",
      "properties": {
        "idea": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "$ref": "#/$defs/T126"
            }
          ]
        },
        "alreadyConverted": {
          "type": "boolean"
        }
      },
      "required": [
        "idea",
        "alreadyConverted"
      ],
      "additionalProperties": false
    },
    "T153": {
      "type": "object",
      "properties": {
        "idea": {
          "$ref": "#/$defs/T154"
        },
        "alreadyConverted": {
          "type": "boolean"
        }
      },
      "required": [
        "alreadyConverted"
      ],
      "additionalProperties": false
    },
    "T154": {
      "type": "object",
      "properties": {
        "projectId": {
          "type": "string"
        },
        "id": {
          "type": "string"
        },
        "title": {
          "type": "string"
        },
        "description": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "updatedAt": {
          "type": "string",
          "format": "date-time"
        },
        "status": {
          "type": "string"
        },
        "deletedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "submittedByMemberId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "submitterDisplay": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "promotedWorkItemId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "score": {
          "type": "string"
        }
      },
      "required": [
        "projectId",
        "id",
        "title",
        "description",
        "createdAt",
        "updatedAt",
        "status",
        "deletedAt",
        "submittedByMemberId",
        "submitterDisplay",
        "promotedWorkItemId",
        "score"
      ],
      "additionalProperties": false
    },
    "T155": {
      "type": "object",
      "properties": {
        "batchId": {
          "type": "string"
        },
        "status": {
          "type": "string"
        },
        "totalRows": {
          "type": "number"
        },
        "header": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "sampleRows": {
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": {
              "type": "string"
            }
          }
        },
        "encoding": {
          "type": "string"
        }
      },
      "required": [
        "batchId",
        "status",
        "totalRows",
        "header",
        "sampleRows",
        "encoding"
      ],
      "additionalProperties": false
    },
    "T156": {
      "type": "object",
      "properties": {
        "errorCount": {
          "type": "integer"
        },
        "id": {
          "type": "string"
        },
        "projectId": {
          "type": "string"
        },
        "source": {
          "type": "string"
        },
        "filename": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "status": {
          "type": "string"
        },
        "totalRows": {
          "type": "number"
        },
        "createdCount": {
          "type": "integer"
        },
        "failedCount": {
          "type": "integer"
        },
        "createdBy": {
          "type": "string"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "startedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "finishedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        }
      },
      "required": [
        "errorCount",
        "id",
        "projectId",
        "source",
        "filename",
        "status",
        "totalRows",
        "createdCount",
        "failedCount",
        "createdBy",
        "createdAt",
        "startedAt",
        "finishedAt"
      ],
      "additionalProperties": false
    },
    "T157": {
      "type": "object",
      "properties": {
        "rows": {
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": {
              "type": "string"
            }
          }
        },
        "offset": {
          "type": "integer"
        },
        "limit": {
          "type": "integer"
        },
        "hasMore": {
          "type": "boolean"
        },
        "errorReport": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T161"
          }
        },
        "errorOffset": {
          "type": "number"
        },
        "errorLimit": {
          "type": "number"
        },
        "errorCount": {
          "type": "integer"
        },
        "errorHasMore": {
          "type": "boolean"
        },
        "header": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "fieldMap": {
          "type": "object",
          "additionalProperties": {
            "type": "string"
          }
        },
        "encoding": {
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ]
        },
        "preview": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "$ref": "#/$defs/JsonValue"
            }
          ]
        },
        "id": {
          "type": "string"
        },
        "projectId": {
          "type": "string"
        },
        "source": {
          "type": "string"
        },
        "filename": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "status": {
          "type": "string"
        },
        "mappingConfig": {
          "$ref": "#/$defs/JsonValue"
        },
        "totalRows": {
          "type": "number"
        },
        "createdCount": {
          "type": "integer"
        },
        "failedCount": {
          "type": "integer"
        },
        "createdBy": {
          "type": "string"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "startedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "finishedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        }
      },
      "required": [
        "rows",
        "offset",
        "limit",
        "hasMore",
        "errorReport",
        "errorOffset",
        "errorLimit",
        "errorCount",
        "errorHasMore",
        "header",
        "fieldMap",
        "encoding",
        "preview",
        "id",
        "projectId",
        "source",
        "filename",
        "status",
        "mappingConfig",
        "totalRows",
        "createdCount",
        "failedCount",
        "createdBy",
        "createdAt",
        "startedAt",
        "finishedAt"
      ],
      "additionalProperties": false
    },
    "T158": {
      "type": "object",
      "properties": {
        "ok": {
          "type": "boolean"
        },
        "mapping": {
          "$ref": "#/$defs/T159"
        }
      },
      "required": [
        "ok",
        "mapping"
      ],
      "additionalProperties": false
    },
    "T159": {
      "type": "object",
      "properties": {
        "fieldMap": {
          "type": "object",
          "additionalProperties": {
            "type": "string"
          }
        },
        "valueMaps": {
          "$ref": "#/$defs/JsonValue"
        },
        "userMap": {
          "type": "object",
          "additionalProperties": {
            "type": "string"
          }
        },
        "externalIdColumn": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "defaultType": {
          "type": "string"
        },
        "preview": {
          "type": "null"
        },
        "encoding": {
          "type": "string"
        },
        "hadBom": {
          "type": "boolean"
        },
        "delimiter": {
          "type": "string"
        },
        "header": {
          "type": "array",
          "items": {
            "type": "string"
          }
        }
      },
      "required": [
        "fieldMap",
        "valueMaps",
        "userMap",
        "externalIdColumn",
        "defaultType",
        "preview"
      ],
      "additionalProperties": {
        "$ref": "#/$defs/JsonValue"
      }
    },
    "T160": {
      "type": "object",
      "properties": {
        "totalRows": {
          "type": "number"
        },
        "willCreate": {
          "type": "number"
        },
        "willSkip": {
          "type": "number"
        },
        "failed": {
          "type": "number"
        },
        "errorReport": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T161"
          }
        }
      },
      "required": [
        "totalRows",
        "willCreate",
        "willSkip",
        "failed",
        "errorReport"
      ],
      "additionalProperties": false
    },
    "T161": {
      "type": "object",
      "properties": {
        "index": {
          "type": "number"
        },
        "externalId": {
          "type": "string"
        },
        "ok": {
          "type": "boolean"
        },
        "reason": {
          "type": "string"
        },
        "code": {
          "type": "string"
        },
        "payload": {
          "type": "object",
          "additionalProperties": {
            "$ref": "#/$defs/JsonValue"
          }
        }
      },
      "required": [
        "index",
        "externalId",
        "ok"
      ],
      "additionalProperties": false
    },
    "T162": {
      "type": "object",
      "properties": {
        "created": {
          "type": "number"
        },
        "skipped": {
          "type": "number"
        },
        "failed": {
          "type": "number"
        },
        "status": {
          "type": "string"
        },
        "errorReport": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T161"
          }
        }
      },
      "required": [
        "created",
        "skipped",
        "failed",
        "status",
        "errorReport"
      ],
      "additionalProperties": false
    },
    "T163": {
      "type": "object",
      "properties": {
        "ok": {
          "type": "boolean"
        },
        "alreadyRolledBack": {
          "type": "boolean"
        },
        "removed": {
          "type": "number"
        },
        "retainedModified": {
          "type": "number"
        },
        "retainedUnknown": {
          "type": "number"
        },
        "skippedDeleted": {
          "type": "number"
        }
      },
      "required": [
        "ok",
        "alreadyRolledBack",
        "removed",
        "retainedModified",
        "retainedUnknown",
        "skippedDeleted"
      ],
      "additionalProperties": false
    },
    "T164": {
      "type": "object",
      "properties": {
        "groups": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T165"
          }
        },
        "total": {
          "type": "integer"
        },
        "crossDomain": {
          "$ref": "#/$defs/T166"
        }
      },
      "required": [
        "groups",
        "total",
        "crossDomain"
      ],
      "additionalProperties": false
    },
    "T165": {
      "type": "object",
      "properties": {
        "key": {
          "type": "string",
          "enum": [
            "assignedToMe",
            "createdByMe",
            "overdue",
            "dueSoon"
          ]
        },
        "name": {
          "type": "string"
        },
        "items": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "id": {
                "type": "string"
              },
              "key": {
                "type": "string"
              },
              "title": {
                "type": "string"
              },
              "type": {
                "type": "string"
              },
              "priority": {
                "anyOf": [
                  {
                    "type": "string"
                  },
                  {
                    "type": "null"
                  }
                ]
              },
              "dueDate": {
                "anyOf": [
                  {
                    "type": "string",
                    "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
                  },
                  {
                    "type": "null"
                  }
                ]
              },
              "version": {
                "type": "integer",
                "minimum": 1
              },
              "projectKey": {
                "type": "string"
              }
            },
            "required": [
              "id",
              "key",
              "title",
              "type",
              "priority",
              "dueDate",
              "version",
              "projectKey"
            ],
            "additionalProperties": false
          }
        },
        "count": {
          "type": "number"
        }
      },
      "required": [
        "key",
        "name",
        "items",
        "count"
      ],
      "additionalProperties": false
    },
    "T166": {
      "type": "object",
      "properties": {
        "defects": {
          "$ref": "#/$defs/T167"
        },
        "myOpenDefects": {
          "type": "number"
        },
        "milestones": {
          "$ref": "#/$defs/T168"
        }
      },
      "required": [
        "defects",
        "myOpenDefects",
        "milestones"
      ],
      "additionalProperties": false
    },
    "T167": {
      "type": "object",
      "properties": {
        "total": {
          "type": "integer"
        },
        "open": {
          "type": "number"
        },
        "p0": {
          "type": "number"
        },
        "done": {
          "type": "number"
        },
        "overdue": {
          "type": "number"
        },
        "donePercent": {
          "type": "number"
        }
      },
      "required": [
        "total",
        "open",
        "p0",
        "done",
        "overdue",
        "donePercent"
      ],
      "additionalProperties": false
    },
    "T168": {
      "type": "object",
      "properties": {
        "overdue": {
          "type": "number"
        },
        "dueSoon": {
          "type": "number"
        },
        "items": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T169"
          }
        }
      },
      "required": [
        "overdue",
        "dueSoon",
        "items"
      ],
      "additionalProperties": false
    },
    "T169": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "dueDate": {
          "type": "string",
          "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
        },
        "projectId": {
          "type": "string"
        },
        "projectKey": {
          "type": "string"
        }
      },
      "required": [
        "id",
        "name",
        "dueDate",
        "projectId",
        "projectKey"
      ],
      "additionalProperties": false
    },
    "T170": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "memberId": {
          "type": "string"
        },
        "title": {
          "type": "string"
        },
        "dueDate": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
            }
          ]
        },
        "done": {
          "type": "boolean"
        },
        "doneAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "memberId",
        "title",
        "dueDate",
        "done",
        "doneAt",
        "createdAt"
      ],
      "additionalProperties": false
    },
    "T171": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "title": {
          "type": "string"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "memberId": {
          "type": "string"
        },
        "dueDate": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
            }
          ]
        },
        "done": {
          "type": "boolean"
        },
        "doneAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        }
      },
      "required": [
        "id",
        "title",
        "createdAt",
        "memberId",
        "dueDate",
        "done",
        "doneAt"
      ],
      "additionalProperties": false
    },
    "T172": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "memberId": {
          "type": "string"
        },
        "title": {
          "type": "string"
        },
        "dueDate": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
            }
          ]
        },
        "done": {
          "type": "boolean"
        },
        "doneAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "memberId",
        "title",
        "dueDate",
        "done",
        "doneAt",
        "createdAt"
      ],
      "additionalProperties": false
    },
    "T173": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "memberId": {
          "type": "string"
        },
        "title": {
          "type": "string"
        },
        "startAt": {
          "type": "string",
          "format": "date-time"
        },
        "endAt": {
          "type": "string",
          "format": "date-time"
        },
        "projectId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "workItemId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "color": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "updatedAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "memberId",
        "title",
        "startAt",
        "endAt",
        "projectId",
        "workItemId",
        "color",
        "createdAt",
        "updatedAt"
      ],
      "additionalProperties": false
    },
    "T174": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "memberId": {
          "type": "string"
        },
        "timeBlockId": {
          "type": "string"
        },
        "startedAt": {
          "type": "string",
          "format": "date-time"
        },
        "endedAt": {
          "type": "string",
          "format": "date-time"
        },
        "actualMinutes": {
          "type": "integer"
        },
        "note": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        }
      },
      "required": [
        "id",
        "memberId",
        "timeBlockId",
        "startedAt",
        "endedAt",
        "actualMinutes",
        "note"
      ],
      "additionalProperties": false
    },
    "T175": {
      "type": "object",
      "properties": {
        "projectId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "workItemId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "id": {
          "type": "string"
        },
        "title": {
          "type": "string"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "updatedAt": {
          "type": "string",
          "format": "date-time"
        },
        "memberId": {
          "type": "string"
        },
        "color": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "startAt": {
          "type": "string",
          "format": "date-time"
        },
        "endAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "projectId",
        "workItemId",
        "id",
        "title",
        "createdAt",
        "updatedAt",
        "memberId",
        "color",
        "startAt",
        "endAt"
      ],
      "additionalProperties": false
    },
    "T176": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "memberId": {
          "type": "string"
        },
        "title": {
          "type": "string"
        },
        "startAt": {
          "type": "string",
          "format": "date-time"
        },
        "endAt": {
          "type": "string",
          "format": "date-time"
        },
        "projectId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "workItemId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "color": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "updatedAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "memberId",
        "title",
        "startAt",
        "endAt",
        "projectId",
        "workItemId",
        "color",
        "createdAt",
        "updatedAt"
      ],
      "additionalProperties": false
    },
    "T177": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "memberId": {
          "type": "string"
        },
        "note": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "startedAt": {
          "type": "string",
          "format": "date-time"
        },
        "timeBlockId": {
          "type": "string"
        },
        "endedAt": {
          "type": "string",
          "format": "date-time"
        },
        "actualMinutes": {
          "type": "integer"
        }
      },
      "required": [
        "id",
        "memberId",
        "note",
        "startedAt",
        "timeBlockId",
        "endedAt",
        "actualMinutes"
      ],
      "additionalProperties": false
    },
    "T178": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "memberId": {
          "type": "string"
        },
        "timeBlockId": {
          "type": "string"
        },
        "startedAt": {
          "type": "string",
          "format": "date-time"
        },
        "endedAt": {
          "type": "string",
          "format": "date-time"
        },
        "actualMinutes": {
          "type": "integer"
        },
        "note": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        }
      },
      "required": [
        "id",
        "memberId",
        "timeBlockId",
        "startedAt",
        "endedAt",
        "actualMinutes",
        "note"
      ],
      "additionalProperties": false
    },
    "T179": {
      "type": "object",
      "properties": {
        "day": {
          "type": "string",
          "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
        },
        "blocks": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T173"
          }
        },
        "sessions": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T174"
          }
        },
        "plannedMinutes": {
          "type": "integer"
        },
        "focusedMinutes": {
          "type": "integer"
        },
        "sessionCount": {
          "type": "integer"
        }
      },
      "required": [
        "day",
        "blocks",
        "sessions",
        "plannedMinutes",
        "focusedMinutes",
        "sessionCount"
      ],
      "additionalProperties": false
    },
    "T180": {
      "type": "object",
      "properties": {
        "ok": {
          "type": "boolean"
        }
      },
      "required": [
        "ok"
      ],
      "additionalProperties": false
    },
    "T181": {
      "type": "object",
      "properties": {
        "ok": {
          "type": "boolean"
        }
      },
      "required": [
        "ok"
      ],
      "additionalProperties": false
    },
    "T182": {
      "type": "object",
      "properties": {
        "ok": {
          "type": "boolean"
        }
      },
      "required": [
        "ok"
      ],
      "additionalProperties": false
    },
    "T183": {
      "type": "object",
      "properties": {
        "ok": {
          "type": "boolean"
        },
        "memberId": {
          "type": "string"
        },
        "roleId": {
          "type": "string"
        },
        "roleIds": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "roleName": {
          "type": "string"
        }
      },
      "required": [
        "ok",
        "memberId",
        "roleId",
        "roleIds",
        "roleName"
      ],
      "additionalProperties": false
    },
    "T184": {
      "type": "object",
      "properties": {
        "ok": {
          "type": "boolean"
        }
      },
      "required": [
        "ok"
      ],
      "additionalProperties": false
    },
    "T185": {
      "type": "object",
      "properties": {
        "members": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T186"
          }
        },
        "page": {
          "type": "integer"
        },
        "pageSize": {
          "type": "integer"
        },
        "hasMore": {
          "type": "boolean"
        }
      },
      "required": [
        "members",
        "page",
        "pageSize",
        "hasMore"
      ],
      "additionalProperties": false
    },
    "T186": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "username": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "status": {
          "type": "string"
        },
        "departmentId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "positionId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        }
      },
      "required": [
        "id",
        "username",
        "name",
        "status",
        "departmentId",
        "positionId"
      ],
      "additionalProperties": false
    },
    "T187": {
      "type": "object",
      "properties": {
        "roles": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T84"
          }
        }
      },
      "required": [
        "roles"
      ],
      "additionalProperties": false
    },
    "T188": {
      "type": "object",
      "properties": {
        "templates": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T24"
          }
        }
      },
      "required": [
        "templates"
      ],
      "additionalProperties": false
    },
    "T189": {
      "type": "object",
      "properties": {
        "iteration": {
          "$ref": "#/$defs/T190"
        },
        "metric": {
          "type": "string"
        },
        "points": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T191"
          }
        }
      },
      "required": [
        "iteration",
        "metric",
        "points"
      ],
      "additionalProperties": false
    },
    "T190": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "startDate": {
          "type": "string",
          "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
        },
        "endDate": {
          "type": "string",
          "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
        }
      },
      "required": [
        "id",
        "name",
        "startDate",
        "endDate"
      ],
      "additionalProperties": false
    },
    "T191": {
      "type": "object",
      "properties": {
        "date": {
          "type": "string",
          "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
        },
        "scope": {
          "type": "number"
        },
        "done": {
          "type": "number"
        },
        "remaining": {
          "type": "number"
        },
        "ideal": {
          "type": "number"
        },
        "source": {
          "type": "string"
        }
      },
      "required": [
        "date",
        "scope",
        "done",
        "remaining",
        "ideal",
        "source"
      ],
      "additionalProperties": false
    },
    "T192": {
      "type": "object",
      "properties": {
        "iteration": {
          "$ref": "#/$defs/T193"
        },
        "metric": {
          "type": "string"
        },
        "categories": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "series": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T194"
          }
        }
      },
      "required": [
        "iteration",
        "metric",
        "categories",
        "series"
      ],
      "additionalProperties": false
    },
    "T193": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "startDate": {
          "type": "string",
          "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
        },
        "endDate": {
          "type": "string",
          "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
        }
      },
      "required": [
        "id",
        "name",
        "startDate",
        "endDate"
      ],
      "additionalProperties": false
    },
    "T194": {
      "type": "object",
      "properties": {
        "total": {
          "type": "integer"
        },
        "date": {
          "type": "string",
          "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
        },
        "NOT_STARTED": {
          "type": "integer",
          "minimum": 0
        },
        "IN_PROGRESS": {
          "type": "integer",
          "minimum": 0
        },
        "TERMINAL": {
          "type": "integer",
          "minimum": 0
        }
      },
      "required": [
        "total",
        "date",
        "NOT_STARTED",
        "IN_PROGRESS",
        "TERMINAL"
      ],
      "additionalProperties": false
    },
    "T195": {
      "type": "object",
      "properties": {
        "metric": {
          "type": "string"
        },
        "days": {
          "type": "number"
        },
        "points": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T196"
          }
        },
        "series": {
          "$ref": "#/$defs/T197"
        }
      },
      "required": [
        "metric",
        "days",
        "points",
        "series"
      ],
      "additionalProperties": false
    },
    "T196": {
      "type": "object",
      "properties": {
        "d": {
          "type": "string"
        },
        "n": {
          "type": "number"
        }
      },
      "required": [
        "d",
        "n"
      ],
      "additionalProperties": false
    },
    "T197": {
      "type": "object",
      "properties": {
        "activity": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T198"
          }
        },
        "created": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T199"
          }
        }
      },
      "required": [
        "activity",
        "created"
      ],
      "additionalProperties": false
    },
    "T198": {
      "type": "object",
      "properties": {
        "d": {
          "type": "string"
        },
        "n": {
          "type": "number"
        }
      },
      "required": [
        "d",
        "n"
      ],
      "additionalProperties": false
    },
    "T199": {
      "type": "object",
      "properties": {
        "d": {
          "type": "string"
        },
        "n": {
          "type": "number"
        }
      },
      "required": [
        "d",
        "n"
      ],
      "additionalProperties": false
    },
    "T200": {
      "type": "object",
      "properties": {
        "dashboards": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T201"
          }
        }
      },
      "required": [
        "dashboards"
      ],
      "additionalProperties": false
    },
    "T201": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "projectId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "ownerId": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "isDefault": {
          "type": "boolean"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "projectId",
        "ownerId",
        "name",
        "isDefault",
        "createdAt"
      ],
      "additionalProperties": false
    },
    "T202": {
      "type": "object",
      "properties": {
        "widgets": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T203"
          }
        },
        "id": {
          "type": "string"
        },
        "projectId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "ownerId": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "isDefault": {
          "type": "boolean"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "widgets",
        "id",
        "projectId",
        "ownerId",
        "name",
        "isDefault",
        "createdAt"
      ],
      "additionalProperties": false
    },
    "T203": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "dashboardId": {
          "type": "string"
        },
        "type": {
          "type": "string"
        },
        "config": {
          "$ref": "#/$defs/JsonValue"
        },
        "sortOrder": {
          "type": "integer"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "dashboardId",
        "type",
        "config",
        "sortOrder",
        "createdAt"
      ],
      "additionalProperties": false
    },
    "T204": {
      "type": "object",
      "properties": {
        "projectId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "id": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "isDefault": {
          "type": "boolean"
        },
        "ownerId": {
          "type": "string"
        }
      },
      "required": [
        "projectId",
        "id",
        "name",
        "createdAt",
        "isDefault",
        "ownerId"
      ],
      "additionalProperties": false
    },
    "T205": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "projectId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "ownerId": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "isDefault": {
          "type": "boolean"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "projectId",
        "ownerId",
        "name",
        "isDefault",
        "createdAt"
      ],
      "additionalProperties": false
    },
    "T206": {
      "type": "object",
      "properties": {
        "widgets": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T203"
          }
        }
      },
      "required": [
        "widgets"
      ],
      "additionalProperties": false
    },
    "T207": {
      "type": "object",
      "properties": {
        "type": {
          "type": "string"
        },
        "id": {
          "type": "string"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "sortOrder": {
          "type": "integer"
        },
        "dashboardId": {
          "type": "string"
        },
        "config": {
          "$ref": "#/$defs/JsonValue"
        }
      },
      "required": [
        "type",
        "id",
        "createdAt",
        "sortOrder",
        "dashboardId",
        "config"
      ],
      "additionalProperties": false
    },
    "T208": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "dashboardId": {
          "type": "string"
        },
        "type": {
          "type": "string"
        },
        "config": {
          "$ref": "#/$defs/JsonValue"
        },
        "sortOrder": {
          "type": "integer"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "dashboardId",
        "type",
        "config",
        "sortOrder",
        "createdAt"
      ],
      "additionalProperties": false
    },
    "T209": {
      "type": "object",
      "properties": {
        "type": {
          "type": "string"
        },
        "metric": {
          "type": "string"
        },
        "data": {
          "type": "null"
        }
      },
      "required": [
        "type",
        "metric",
        "data"
      ],
      "additionalProperties": false
    },
    "T210": {
      "type": "object",
      "properties": {
        "type": {
          "type": "string",
          "const": "COUNT"
        },
        "metric": {
          "type": "string"
        },
        "data": {
          "$ref": "#/$defs/T211"
        }
      },
      "required": [
        "type",
        "metric",
        "data"
      ],
      "additionalProperties": false
    },
    "T211": {
      "type": "object",
      "properties": {
        "total": {
          "type": "integer"
        }
      },
      "required": [
        "total"
      ],
      "additionalProperties": false
    },
    "T212": {
      "type": "object",
      "properties": {
        "type": {
          "type": "string",
          "const": "PIE"
        },
        "metric": {
          "type": "string"
        },
        "data": {
          "$ref": "#/$defs/T213"
        }
      },
      "required": [
        "type",
        "metric",
        "data"
      ],
      "additionalProperties": false
    },
    "T213": {
      "type": "object",
      "properties": {
        "slices": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T214"
          }
        }
      },
      "required": [
        "slices"
      ],
      "additionalProperties": false
    },
    "T214": {
      "type": "object",
      "properties": {
        "label": {
          "type": "string"
        },
        "value": {
          "type": "number"
        }
      },
      "required": [
        "label",
        "value"
      ],
      "additionalProperties": false
    },
    "T215": {
      "type": "object",
      "properties": {
        "type": {
          "type": "string",
          "const": "LIST"
        },
        "metric": {
          "type": "string"
        },
        "data": {
          "$ref": "#/$defs/T216"
        }
      },
      "required": [
        "type",
        "metric",
        "data"
      ],
      "additionalProperties": false
    },
    "T216": {
      "type": "object",
      "properties": {
        "rows": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T217"
          }
        }
      },
      "required": [
        "rows"
      ],
      "additionalProperties": false
    },
    "T217": {
      "type": "object",
      "properties": {
        "key": {
          "type": "string"
        },
        "title": {
          "type": "string"
        },
        "priority": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        }
      },
      "required": [
        "key",
        "title",
        "priority"
      ],
      "additionalProperties": false
    },
    "T218": {
      "type": "object",
      "properties": {
        "type": {
          "type": "string",
          "const": "ACTIVITY_HEATMAP"
        },
        "metric": {
          "type": "string"
        },
        "data": {
          "$ref": "#/$defs/T219"
        }
      },
      "required": [
        "type",
        "metric",
        "data"
      ],
      "additionalProperties": false
    },
    "T219": {
      "type": "object",
      "properties": {
        "cells": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T220"
          }
        }
      },
      "required": [
        "cells"
      ],
      "additionalProperties": false
    },
    "T220": {
      "type": "object",
      "properties": {
        "date": {
          "type": "string",
          "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
        },
        "value": {
          "type": "number"
        }
      },
      "required": [
        "date",
        "value"
      ],
      "additionalProperties": false
    },
    "T221": {
      "type": "object",
      "properties": {
        "portfolios": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T222"
          }
        }
      },
      "required": [
        "portfolios"
      ],
      "additionalProperties": false
    },
    "T222": {
      "type": "object",
      "properties": {
        "projectCount": {
          "type": "integer"
        },
        "workItemCount": {
          "type": "integer"
        },
        "id": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "ownerId": {
          "type": "string"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "projectCount",
        "workItemCount",
        "id",
        "name",
        "ownerId",
        "createdAt"
      ],
      "additionalProperties": false
    },
    "T223": {
      "type": "object",
      "properties": {
        "projectCount": {
          "type": "integer"
        },
        "workItemCount": {
          "type": "integer"
        },
        "projects": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T224"
          }
        },
        "id": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "ownerId": {
          "type": "string"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "projectCount",
        "workItemCount",
        "projects",
        "id",
        "name",
        "ownerId",
        "createdAt"
      ],
      "additionalProperties": false
    },
    "T224": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "key": {
          "type": "string"
        },
        "name": {
          "type": "string"
        }
      },
      "required": [
        "id",
        "key",
        "name"
      ],
      "additionalProperties": false
    },
    "T225": {
      "type": "object",
      "properties": {
        "projectCount": {
          "type": "integer"
        },
        "workItemCount": {
          "type": "integer"
        },
        "id": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "ownerId": {
          "type": "string"
        }
      },
      "required": [
        "projectCount",
        "workItemCount",
        "id",
        "name",
        "createdAt",
        "ownerId"
      ],
      "additionalProperties": false
    },
    "T226": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "ownerId": {
          "type": "string"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "name",
        "ownerId",
        "createdAt"
      ],
      "additionalProperties": false
    },
    "T227": {
      "type": "object",
      "properties": {
        "ok": {
          "type": "boolean"
        }
      },
      "required": [
        "ok"
      ],
      "additionalProperties": false
    },
    "T228": {
      "type": "object",
      "properties": {
        "ok": {
          "type": "boolean"
        }
      },
      "required": [
        "ok"
      ],
      "additionalProperties": false
    },
    "T229": {
      "type": "object",
      "properties": {
        "portfolio": {
          "$ref": "#/$defs/T230"
        },
        "projects": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T231"
          }
        },
        "totals": {
          "$ref": "#/$defs/T234"
        },
        "risks": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T235"
          }
        },
        "milestones": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T236"
          }
        },
        "activity": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T237"
          }
        }
      },
      "required": [
        "portfolio",
        "projects",
        "totals",
        "risks",
        "milestones",
        "activity"
      ],
      "additionalProperties": false
    },
    "T230": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "name",
        "createdAt"
      ],
      "additionalProperties": false
    },
    "T231": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "key": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "status": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "$ref": "#/$defs/T232"
            }
          ]
        },
        "total": {
          "type": "integer"
        },
        "done": {
          "type": "number"
        },
        "overdue": {
          "type": "number"
        },
        "progress": {
          "type": "number"
        },
        "insights": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "$ref": "#/$defs/T233"
            }
          ]
        }
      },
      "required": [
        "id",
        "key",
        "name",
        "status",
        "total",
        "done",
        "overdue",
        "progress",
        "insights"
      ],
      "additionalProperties": false
    },
    "T232": {
      "type": "object",
      "properties": {
        "key": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "category": {
          "type": "string"
        }
      },
      "required": [
        "key",
        "name",
        "category"
      ],
      "additionalProperties": false
    },
    "T233": {
      "type": "object",
      "properties": {
        "overdueMilestones": {
          "type": "number"
        },
        "overdueWorkItems": {
          "type": "number"
        },
        "urgentDefects": {
          "type": "number"
        },
        "lastActivityAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "memberCount": {
          "type": "integer"
        }
      },
      "required": [
        "overdueMilestones",
        "overdueWorkItems",
        "urgentDefects",
        "lastActivityAt",
        "memberCount"
      ],
      "additionalProperties": false
    },
    "T234": {
      "type": "object",
      "properties": {
        "projectCount": {
          "type": "integer"
        },
        "workItemCount": {
          "type": "integer"
        },
        "doneCount": {
          "type": "integer"
        },
        "overdueCount": {
          "type": "integer"
        },
        "completionPercent": {
          "type": "number"
        }
      },
      "required": [
        "projectCount",
        "workItemCount",
        "doneCount",
        "overdueCount",
        "completionPercent"
      ],
      "additionalProperties": false
    },
    "T235": {
      "type": "object",
      "properties": {
        "projectId": {
          "type": "string"
        },
        "projectName": {
          "type": "string"
        },
        "type": {
          "type": "string"
        },
        "count": {
          "type": "number"
        }
      },
      "required": [
        "projectId",
        "projectName",
        "type",
        "count"
      ],
      "additionalProperties": false
    },
    "T236": {
      "type": "object",
      "properties": {
        "projectName": {
          "type": "string"
        },
        "id": {
          "type": "string"
        },
        "projectId": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "dueDate": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
            }
          ]
        },
        "completedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "archivedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        }
      },
      "required": [
        "projectName",
        "id",
        "projectId",
        "name",
        "dueDate",
        "completedAt",
        "archivedAt"
      ],
      "additionalProperties": false
    },
    "T237": {
      "type": "object",
      "properties": {
        "projectName": {
          "type": "string"
        },
        "id": {
          "type": "string"
        },
        "projectId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "summary": {
          "type": "string"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "projectName",
        "id",
        "projectId",
        "summary",
        "createdAt"
      ],
      "additionalProperties": false
    },
    "T238": {
      "type": "object",
      "properties": {
        "definitions": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T239"
          }
        }
      },
      "required": [
        "definitions"
      ],
      "additionalProperties": false
    },
    "T239": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "projectId": {
          "type": "string"
        },
        "key": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "type": {
          "type": "string"
        },
        "options": {
          "$ref": "#/$defs/JsonValue"
        },
        "requiredStates": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "isRequired": {
          "type": "boolean"
        },
        "sortOrder": {
          "type": "integer"
        },
        "archivedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "projectId",
        "key",
        "name",
        "type",
        "options",
        "requiredStates",
        "isRequired",
        "sortOrder",
        "archivedAt",
        "createdAt"
      ],
      "additionalProperties": false
    },
    "T240": {
      "type": "object",
      "properties": {
        "type": {
          "type": "string"
        },
        "projectId": {
          "type": "string"
        },
        "options": {
          "$ref": "#/$defs/JsonValue"
        },
        "key": {
          "type": "string"
        },
        "id": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "sortOrder": {
          "type": "integer"
        },
        "archivedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "requiredStates": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "isRequired": {
          "type": "boolean"
        }
      },
      "required": [
        "type",
        "projectId",
        "options",
        "key",
        "id",
        "name",
        "createdAt",
        "sortOrder",
        "archivedAt",
        "requiredStates",
        "isRequired"
      ],
      "additionalProperties": false
    },
    "T241": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "projectId": {
          "type": "string"
        },
        "key": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "type": {
          "type": "string"
        },
        "options": {
          "$ref": "#/$defs/JsonValue"
        },
        "requiredStates": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "isRequired": {
          "type": "boolean"
        },
        "sortOrder": {
          "type": "integer"
        },
        "archivedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "projectId",
        "key",
        "name",
        "type",
        "options",
        "requiredStates",
        "isRequired",
        "sortOrder",
        "archivedAt",
        "createdAt"
      ],
      "additionalProperties": false
    },
    "T242": {
      "type": "object",
      "properties": {
        "filename": {
          "type": "string"
        },
        "mimeType": {
          "type": "string"
        },
        "sizeBytes": {
          "type": "integer"
        },
        "contentBase64": {
          "type": "string"
        }
      },
      "required": [
        "filename",
        "mimeType",
        "sizeBytes",
        "contentBase64"
      ],
      "additionalProperties": false
    },
    "T243": {
      "type": "object",
      "properties": {
        "mimeType": {
          "type": "string"
        },
        "schemaVersion": {
          "type": "string"
        },
        "csv": {
          "type": "string"
        },
        "count": {
          "type": "number"
        }
      },
      "required": [
        "mimeType",
        "schemaVersion",
        "csv",
        "count"
      ],
      "additionalProperties": false
    },
    "T244": {
      "type": "object",
      "properties": {
        "integrations": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T245"
          }
        }
      },
      "required": [
        "integrations"
      ],
      "additionalProperties": false
    },
    "T245": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "projectId": {
          "type": "string"
        },
        "kind": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "isActive": {
          "type": "boolean"
        },
        "hasToken": {
          "type": "boolean",
          "const": true
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "updatedAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "projectId",
        "kind",
        "name",
        "isActive",
        "hasToken",
        "createdAt",
        "updatedAt"
      ],
      "additionalProperties": false
    },
    "T246": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "projectId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "kind": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "isActive": {
          "type": "boolean"
        },
        "hasToken": {
          "type": "boolean",
          "const": true
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "updatedAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "projectId",
        "kind",
        "name",
        "isActive",
        "hasToken",
        "createdAt",
        "updatedAt"
      ],
      "additionalProperties": false
    },
    "T247": {
      "type": "object",
      "properties": {
        "ok": {
          "type": "boolean"
        }
      },
      "required": [
        "ok"
      ],
      "additionalProperties": false
    },
    "T248": {
      "type": "object",
      "properties": {
        "integrationId": {
          "type": "string"
        },
        "projectId": {
          "type": "string"
        },
        "isActive": {
          "type": "boolean"
        },
        "hasToken": {
          "type": "boolean",
          "const": true
        },
        "entity": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "lastSyncedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        }
      },
      "required": [
        "integrationId",
        "projectId",
        "isActive",
        "hasToken",
        "entity",
        "lastSyncedAt"
      ],
      "additionalProperties": false
    },
    "T249": {
      "type": "object",
      "properties": {
        "integrationId": {
          "type": "string"
        },
        "projectId": {
          "type": "string"
        },
        "fetched": {
          "type": "number"
        },
        "synced": {
          "type": "number"
        },
        "skipped": {
          "type": "number"
        },
        "pulls": {
          "$ref": "#/$defs/T250"
        },
        "reviews": {
          "$ref": "#/$defs/T251"
        },
        "members": {
          "type": "number"
        }
      },
      "required": [
        "integrationId",
        "projectId",
        "fetched",
        "synced",
        "skipped",
        "pulls",
        "reviews",
        "members"
      ],
      "additionalProperties": false
    },
    "T250": {
      "type": "object",
      "properties": {
        "fetched": {
          "type": "number"
        },
        "synced": {
          "type": "number"
        },
        "skipped": {
          "type": "number"
        }
      },
      "required": [
        "fetched",
        "synced",
        "skipped"
      ],
      "additionalProperties": false
    },
    "T251": {
      "type": "object",
      "properties": {
        "fetched": {
          "type": "number"
        },
        "synced": {
          "type": "number"
        },
        "skipped": {
          "type": "number"
        }
      },
      "required": [
        "fetched",
        "synced",
        "skipped"
      ],
      "additionalProperties": false
    },
    "T252": {
      "type": "object",
      "properties": {
        "endpoints": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T253"
          }
        }
      },
      "required": [
        "endpoints"
      ],
      "additionalProperties": false
    },
    "T253": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "projectId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "name": {
          "type": "string"
        },
        "url": {
          "type": "string"
        },
        "events": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "isActive": {
          "type": "boolean"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "projectId",
        "name",
        "url",
        "events",
        "isActive",
        "createdAt"
      ],
      "additionalProperties": false
    },
    "T254": {
      "type": "object",
      "properties": {
        "endpoint": {
          "$ref": "#/$defs/T255"
        },
        "secret": {
          "type": "string"
        }
      },
      "required": [
        "endpoint",
        "secret"
      ],
      "additionalProperties": false
    },
    "T255": {
      "type": "object",
      "properties": {
        "projectId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "id": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "isActive": {
          "type": "boolean"
        },
        "url": {
          "type": "string"
        },
        "events": {
          "type": "array",
          "items": {
            "type": "string"
          }
        }
      },
      "required": [
        "projectId",
        "id",
        "name",
        "createdAt",
        "isActive",
        "url",
        "events"
      ],
      "additionalProperties": false
    },
    "T256": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "projectId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "name": {
          "type": "string"
        },
        "url": {
          "type": "string"
        },
        "events": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "isActive": {
          "type": "boolean"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "projectId",
        "name",
        "url",
        "events",
        "isActive",
        "createdAt"
      ],
      "additionalProperties": false
    },
    "T257": {
      "type": "object",
      "properties": {
        "ok": {
          "type": "boolean"
        }
      },
      "required": [
        "ok"
      ],
      "additionalProperties": false
    },
    "T258": {
      "type": "object",
      "properties": {
        "deliveries": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T259"
          }
        }
      },
      "required": [
        "deliveries"
      ],
      "additionalProperties": false
    },
    "T259": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "endpointId": {
          "type": "string"
        },
        "event": {
          "type": "string"
        },
        "status": {
          "type": "string"
        },
        "attempts": {
          "type": "number"
        },
        "responseCode": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "number"
            }
          ]
        },
        "nextRetryAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "finishedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        }
      },
      "required": [
        "id",
        "endpointId",
        "event",
        "status",
        "attempts",
        "responseCode",
        "nextRetryAt",
        "createdAt",
        "finishedAt"
      ],
      "additionalProperties": false
    },
    "T260": {
      "type": "object",
      "properties": {
        "dead": {
          "anyOf": [
            {
              "type": "boolean",
              "const": false
            },
            {
              "type": "boolean",
              "const": true
            }
          ]
        },
        "responseCode": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "number"
            }
          ]
        },
        "attempts": {
          "type": "number"
        },
        "deliveryId": {
          "type": "string"
        },
        "endpointId": {
          "type": "string"
        },
        "ok": {
          "type": "boolean"
        }
      },
      "required": [
        "deliveryId",
        "endpointId",
        "ok"
      ],
      "additionalProperties": false
    },
    "T261": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "projectId": {
          "type": "string"
        },
        "completedAt": {
          "type": "string",
          "format": "date-time"
        },
        "targetIterationId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "carriedOverCount": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "integer"
            }
          ]
        },
        "remainingCount": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "integer"
            }
          ]
        },
        "movedCount": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "integer"
            }
          ]
        },
        "movedWorkItemIds": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "array",
              "items": {
                "type": "string"
              }
            }
          ]
        }
      },
      "required": [
        "id",
        "projectId",
        "completedAt",
        "targetIterationId",
        "carriedOverCount",
        "remainingCount",
        "movedCount",
        "movedWorkItemIds"
      ],
      "additionalProperties": false
    },
    "T262": {
      "type": "object",
      "properties": {
        "parent": {
          "$ref": "#/$defs/T263"
        },
        "children": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T264"
          }
        }
      },
      "required": [
        "parent",
        "children"
      ],
      "additionalProperties": false
    },
    "T263": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "key": {
          "type": "string"
        },
        "title": {
          "type": "string"
        }
      },
      "required": [
        "id",
        "key",
        "title"
      ],
      "additionalProperties": false
    },
    "T264": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "key": {
          "type": "string"
        },
        "title": {
          "type": "string"
        },
        "type": {
          "type": "string"
        },
        "priority": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "status_id": {
          "type": "string"
        }
      },
      "required": [
        "id",
        "key",
        "title",
        "type",
        "priority",
        "status_id"
      ],
      "additionalProperties": false
    },
    "T265": {
      "type": "object",
      "properties": {
        "ok": {
          "type": "boolean"
        }
      },
      "required": [
        "ok"
      ],
      "additionalProperties": false
    },
    "T266": {
      "type": "object",
      "properties": {
        "blocks": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T267"
          }
        },
        "blockedBy": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T268"
          }
        },
        "others": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T269"
          }
        }
      },
      "required": [
        "blocks",
        "blockedBy",
        "others"
      ],
      "additionalProperties": false
    },
    "T267": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "workItemId": {
          "type": "string"
        },
        "relatedWorkItemId": {
          "type": "string"
        },
        "projectId": {
          "type": "string"
        },
        "key": {
          "type": "string"
        },
        "title": {
          "type": "string"
        }
      },
      "required": [
        "id",
        "workItemId",
        "relatedWorkItemId",
        "projectId",
        "key",
        "title"
      ],
      "additionalProperties": false
    },
    "T268": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "workItemId": {
          "type": "string"
        },
        "relatedWorkItemId": {
          "type": "string"
        },
        "projectId": {
          "type": "string"
        },
        "key": {
          "type": "string"
        },
        "title": {
          "type": "string"
        }
      },
      "required": [
        "id",
        "workItemId",
        "relatedWorkItemId",
        "projectId",
        "key",
        "title"
      ],
      "additionalProperties": false
    },
    "T269": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "type": {
          "type": "string"
        },
        "workItemId": {
          "type": "string"
        },
        "relatedWorkItemId": {
          "type": "string"
        },
        "projectId": {
          "type": "string"
        },
        "key": {
          "type": "string"
        },
        "title": {
          "type": "string"
        }
      },
      "required": [
        "id",
        "type",
        "workItemId",
        "relatedWorkItemId",
        "projectId",
        "key",
        "title"
      ],
      "additionalProperties": false
    },
    "T270": {
      "type": "object",
      "properties": {
        "projectId": {
          "type": "string"
        },
        "id": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "parentId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "sortOrder": {
          "type": "integer"
        },
        "archivedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "leadMemberId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        }
      },
      "required": [
        "projectId",
        "id",
        "name",
        "parentId",
        "sortOrder",
        "archivedAt",
        "leadMemberId"
      ],
      "additionalProperties": false
    },
    "T271": {
      "type": "object",
      "properties": {
        "members": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T272"
          }
        }
      },
      "required": [
        "members"
      ],
      "additionalProperties": false
    },
    "T272": {
      "type": "object",
      "properties": {
        "memberId": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "username": {
          "type": "string"
        },
        "capacityPoints": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "number"
            }
          ]
        },
        "capacityHours": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "number"
            }
          ]
        },
        "loggedPoints": {
          "type": "number"
        }
      },
      "required": [
        "memberId",
        "name",
        "username",
        "capacityPoints",
        "capacityHours",
        "loggedPoints"
      ],
      "additionalProperties": false
    },
    "T273": {
      "type": "object",
      "properties": {
        "ok": {
          "type": "boolean"
        },
        "capacity": {
          "$ref": "#/$defs/T274"
        }
      },
      "required": [
        "ok"
      ],
      "additionalProperties": false
    },
    "T274": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "memberId": {
          "type": "string"
        },
        "iterationId": {
          "type": "string"
        },
        "capacityPoints": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "capacityHours": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "loggedPoints": {
          "type": "string"
        }
      },
      "required": [
        "id",
        "memberId",
        "iterationId",
        "capacityPoints",
        "capacityHours",
        "loggedPoints"
      ],
      "additionalProperties": false
    },
    "T275": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "ownerId": {
          "type": "string"
        },
        "scope": {
          "type": "string"
        },
        "projectId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "viewType": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "filters": {
          "$ref": "#/$defs/JsonValue"
        },
        "sorts": {
          "$ref": "#/$defs/JsonValue"
        },
        "isPinned": {
          "type": "boolean"
        },
        "sortOrder": {
          "type": "integer"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "updatedAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "ownerId",
        "scope",
        "projectId",
        "viewType",
        "name",
        "filters",
        "sorts",
        "isPinned",
        "sortOrder",
        "createdAt",
        "updatedAt"
      ],
      "additionalProperties": false
    },
    "T276": {
      "type": "object",
      "properties": {
        "updates": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T3"
          }
        }
      },
      "required": [
        "updates"
      ],
      "additionalProperties": false
    },
    "T277": {
      "type": "object",
      "properties": {
        "milestone": {
          "$ref": "#/$defs/T278"
        },
        "project": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "$ref": "#/$defs/T279"
            }
          ]
        },
        "relatedWorkItems": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T280"
          }
        },
        "progressUpdates": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T281"
          }
        }
      },
      "required": [
        "milestone",
        "project",
        "relatedWorkItems",
        "progressUpdates"
      ],
      "additionalProperties": false
    },
    "T278": {
      "type": "object",
      "properties": {
        "projectId": {
          "type": "string"
        },
        "id": {
          "type": "string"
        },
        "description": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "name": {
          "type": "string"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "updatedAt": {
          "type": "string",
          "format": "date-time"
        },
        "sortOrder": {
          "type": "integer"
        },
        "archivedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "startDate": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
            }
          ]
        },
        "dueDate": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
            }
          ]
        },
        "progressMode": {
          "type": "string"
        },
        "progressValue": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "completedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        }
      },
      "required": [
        "projectId",
        "id",
        "description",
        "name",
        "createdAt",
        "updatedAt",
        "sortOrder",
        "archivedAt",
        "startDate",
        "dueDate",
        "progressMode",
        "progressValue",
        "completedAt"
      ],
      "additionalProperties": false
    },
    "T279": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "key": {
          "type": "string"
        },
        "name": {
          "type": "string"
        }
      },
      "required": [
        "id",
        "key",
        "name"
      ],
      "additionalProperties": false
    },
    "T280": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "key": {
          "type": "string"
        },
        "title": {
          "type": "string"
        },
        "type": {
          "type": "string"
        },
        "statusName": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "statusCategory": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "priority": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "dueDate": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
            }
          ]
        }
      },
      "required": [
        "id",
        "key",
        "title",
        "type",
        "statusName",
        "statusCategory",
        "priority",
        "dueDate"
      ],
      "additionalProperties": false
    },
    "T281": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "summary": {
          "type": "string"
        },
        "nextSteps": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "blockers": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "authorName": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        }
      },
      "required": [
        "id",
        "summary",
        "nextSteps",
        "blockers",
        "createdAt",
        "authorName"
      ],
      "additionalProperties": false
    },
    "T282": {
      "type": "object",
      "properties": {
        "updates": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T281"
          }
        }
      },
      "required": [
        "updates"
      ],
      "additionalProperties": false
    },
    "T283": {
      "type": "object",
      "properties": {
        "projectId": {
          "type": "string"
        },
        "id": {
          "type": "string"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "milestoneId": {
          "type": "string"
        },
        "authorId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "summary": {
          "type": "string"
        },
        "nextSteps": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "blockers": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        }
      },
      "required": [
        "projectId",
        "id",
        "createdAt",
        "milestoneId",
        "authorId",
        "summary",
        "nextSteps",
        "blockers"
      ],
      "additionalProperties": false
    },
    "T284": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "logoUrl": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "defaultLocale": {
          "type": "string"
        },
        "defaultTimezone": {
          "type": "string"
        },
        "createdAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "updatedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        }
      },
      "required": [
        "id",
        "name",
        "logoUrl",
        "defaultLocale",
        "defaultTimezone",
        "createdAt",
        "updatedAt"
      ],
      "additionalProperties": false
    },
    "T285": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "logoUrl": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "defaultLocale": {
          "type": "string"
        },
        "defaultTimezone": {
          "type": "string"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "updatedAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "name",
        "logoUrl",
        "defaultLocale",
        "defaultTimezone",
        "createdAt",
        "updatedAt"
      ],
      "additionalProperties": false
    },
    "T286": {
      "type": "object",
      "properties": {
        "departments": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T287"
          }
        },
        "positions": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T288"
          }
        }
      },
      "required": [
        "departments",
        "positions"
      ],
      "additionalProperties": false
    },
    "T287": {
      "type": "object",
      "properties": {
        "name": {
          "type": "string"
        },
        "children": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T287"
          }
        }
      },
      "required": [
        "name"
      ],
      "additionalProperties": false
    },
    "T288": {
      "type": "object",
      "properties": {
        "name": {
          "type": "string"
        },
        "dept": {
          "type": "string"
        }
      },
      "required": [
        "name"
      ],
      "additionalProperties": false
    },
    "T289": {
      "type": "object",
      "properties": {
        "ok": {
          "type": "boolean"
        }
      },
      "required": [
        "ok"
      ],
      "additionalProperties": false
    },
    "T290": {
      "type": "object",
      "properties": {
        "ok": {
          "type": "boolean"
        }
      },
      "required": [
        "ok"
      ],
      "additionalProperties": false
    },
    "T291": {
      "type": "object",
      "properties": {
        "teams": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T103"
          }
        }
      },
      "required": [
        "teams"
      ],
      "additionalProperties": false
    },
    "T292": {
      "type": "object",
      "properties": {
        "ok": {
          "type": "boolean"
        }
      },
      "required": [
        "ok"
      ],
      "additionalProperties": false
    },
    "T293": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "username": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "email": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "status": {
          "type": "string"
        },
        "timezone": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "locale": {
          "type": "string"
        },
        "lastLoginAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "anonymizedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "departmentId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "departmentName": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "positionId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "positionName": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        }
      },
      "required": [
        "id",
        "username",
        "name",
        "email",
        "status",
        "timezone",
        "locale",
        "lastLoginAt",
        "createdAt",
        "anonymizedAt",
        "departmentId",
        "departmentName",
        "positionId",
        "positionName"
      ],
      "additionalProperties": false
    },
    "T294": {
      "type": "object",
      "properties": {
        "member": {
          "$ref": "#/$defs/T295"
        },
        "assignments": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T296"
          }
        },
        "permissions": {
          "type": "array",
          "items": {
            "type": "string"
          }
        }
      },
      "required": [
        "member",
        "assignments",
        "permissions"
      ],
      "additionalProperties": false
    },
    "T295": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "username": {
          "type": "string"
        },
        "name": {
          "type": "string"
        }
      },
      "required": [
        "id",
        "username",
        "name"
      ],
      "additionalProperties": false
    },
    "T296": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "scopeType": {
          "type": "string"
        },
        "scopeId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "role": {
          "$ref": "#/$defs/T297"
        }
      },
      "required": [
        "id",
        "scopeType",
        "scopeId",
        "role"
      ],
      "additionalProperties": false
    },
    "T297": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "key": {
          "type": "string"
        },
        "name": {
          "type": "string"
        }
      },
      "required": [
        "id",
        "key",
        "name"
      ],
      "additionalProperties": false
    },
    "T298": {
      "type": "object",
      "properties": {
        "ok": {
          "type": "boolean"
        }
      },
      "required": [
        "ok"
      ],
      "additionalProperties": false
    },
    "T299": {
      "type": "object",
      "properties": {
        "roles": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T84"
          }
        }
      },
      "required": [
        "roles"
      ],
      "additionalProperties": false
    },
    "T300": {
      "type": "object",
      "properties": {
        "groups": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T82"
          }
        }
      },
      "required": [
        "groups"
      ],
      "additionalProperties": false
    },
    "T301": {
      "type": "object",
      "properties": {
        "ok": {
          "type": "boolean"
        }
      },
      "required": [
        "ok"
      ],
      "additionalProperties": false
    },
    "T302": {
      "type": "object",
      "properties": {
        "assignments": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T92"
          }
        }
      },
      "required": [
        "assignments"
      ],
      "additionalProperties": false
    },
    "T303": {
      "type": "object",
      "properties": {
        "ok": {
          "type": "boolean"
        }
      },
      "required": [
        "ok"
      ],
      "additionalProperties": false
    },
    "T304": {
      "type": "object",
      "properties": {
        "conversation": {
          "$ref": "#/$defs/T305"
        },
        "message": {
          "$ref": "#/$defs/T306"
        }
      },
      "required": [
        "conversation",
        "message"
      ],
      "additionalProperties": false
    },
    "T305": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "title": {
          "type": "string"
        },
        "projectId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "projectName": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "available": {
          "type": "boolean"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "updatedAt": {
          "type": "string",
          "format": "date-time"
        },
        "deletedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        }
      },
      "required": [
        "id",
        "title",
        "projectId",
        "projectName",
        "available",
        "createdAt",
        "updatedAt",
        "deletedAt"
      ],
      "additionalProperties": false
    },
    "T306": {
      "type": "object",
      "properties": {
        "references": {
          "$ref": "#/$defs/T307"
        },
        "id": {
          "type": "string"
        },
        "conversationId": {
          "type": "string"
        },
        "requestId": {
          "type": "string"
        },
        "question": {
          "type": "string"
        },
        "status": {
          "type": "string",
          "enum": [
            "failed",
            "pending",
            "completed",
            "cancelled",
            "unavailable"
          ]
        },
        "reply": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "$ref": "#/$defs/T308"
            }
          ]
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "updatedAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "conversationId",
        "requestId",
        "question",
        "status",
        "reply",
        "createdAt",
        "updatedAt"
      ],
      "additionalProperties": false
    },
    "T307": {
      "type": "object",
      "properties": {
        "artifactIds": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "credentialRefs": {
          "type": "array",
          "items": {
            "type": "string"
          }
        }
      },
      "required": [],
      "additionalProperties": false
    },
    "T308": {
      "type": "object",
      "properties": {
        "evidence": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T309"
          }
        },
        "actions": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T314"
          }
        },
        "ok": {
          "type": "boolean"
        },
        "answer": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "citations": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T321"
          }
        },
        "mode": {
          "type": "string",
          "enum": [
            "vector",
            "keyword",
            "none"
          ]
        },
        "note": {
          "type": "string"
        },
        "scope": {
          "$ref": "#/$defs/T322"
        }
      },
      "required": [
        "ok",
        "answer",
        "citations",
        "mode",
        "scope"
      ],
      "additionalProperties": false
    },
    "T309": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "toolName": {
          "type": "string"
        },
        "projectId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "scope": {
          "anyOf": [
            {
              "$ref": "#/$defs/T310"
            },
            {
              "$ref": "#/$defs/T311"
            }
          ]
        },
        "verificationReads": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T312"
          }
        },
        "observedAt": {
          "type": "string",
          "format": "date-time"
        },
        "resources": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T313"
          }
        },
        "summary": {
          "type": "string"
        },
        "readTools": {
          "type": "array",
          "items": {
            "type": "string"
          }
        }
      },
      "required": [
        "id",
        "toolName",
        "projectId",
        "observedAt",
        "resources",
        "summary"
      ],
      "additionalProperties": false
    },
    "T310": {
      "type": "object",
      "properties": {
        "kind": {
          "type": "string",
          "enum": [
            "project",
            "project-set"
          ]
        },
        "projectIds": {
          "type": "array",
          "items": {
            "type": "string"
          }
        }
      },
      "required": [
        "kind",
        "projectIds"
      ],
      "additionalProperties": false
    },
    "T311": {
      "type": "object",
      "properties": {
        "kind": {
          "type": "string",
          "enum": [
            "account",
            "personal"
          ]
        },
        "ownerId": {
          "type": "string"
        }
      },
      "required": [
        "kind",
        "ownerId"
      ],
      "additionalProperties": false
    },
    "T312": {
      "type": "object",
      "properties": {
        "toolName": {
          "type": "string"
        },
        "parameters": {
          "type": "object",
          "additionalProperties": {
            "$ref": "#/$defs/JsonValue"
          }
        }
      },
      "required": [
        "toolName",
        "parameters"
      ],
      "additionalProperties": false
    },
    "T313": {
      "type": "object",
      "properties": {
        "kind": {
          "type": "string",
          "enum": [
            "milestone",
            "iteration",
            "release",
            "module",
            "comment",
            "workItem",
            "page",
            "idea"
          ]
        },
        "id": {
          "type": "string"
        }
      },
      "required": [
        "kind",
        "id"
      ],
      "additionalProperties": false
    },
    "T314": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "toolName": {
          "type": "string"
        },
        "projectId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "scope": {
          "anyOf": [
            {
              "$ref": "#/$defs/T310"
            },
            {
              "$ref": "#/$defs/T311"
            }
          ]
        },
        "verificationReads": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T312"
          }
        },
        "targetId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "parameters": {
          "type": "object",
          "additionalProperties": {
            "$ref": "#/$defs/JsonValue"
          }
        },
        "expectedVersion": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "integer"
            }
          ]
        },
        "target": {
          "$ref": "#/$defs/T315"
        },
        "resources": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T313"
          }
        },
        "observations": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T316"
          }
        },
        "presentation": {
          "$ref": "#/$defs/T317"
        },
        "result": {
          "$ref": "#/$defs/T319"
        },
        "status": {
          "type": "string",
          "enum": [
            "failed",
            "pending",
            "confirmed",
            "rejected",
            "expired",
            "queued",
            "running",
            "uncertain"
          ]
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "expiresAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "toolName",
        "projectId",
        "targetId",
        "parameters",
        "expectedVersion",
        "status",
        "createdAt",
        "expiresAt"
      ],
      "additionalProperties": false
    },
    "T315": {
      "type": "object",
      "properties": {
        "kind": {
          "type": "string",
          "enum": [
            "milestone",
            "iteration",
            "release",
            "module",
            "comment",
            "workItem",
            "page",
            "idea"
          ]
        },
        "id": {
          "type": "string"
        },
        "fingerprint": {
          "type": "string"
        },
        "preview": {
          "type": "object",
          "additionalProperties": {
            "anyOf": [
              {
                "type": "null"
              },
              {
                "type": "string"
              },
              {
                "type": "number"
              }
            ]
          }
        }
      },
      "required": [
        "kind",
        "id",
        "fingerprint"
      ],
      "additionalProperties": false
    },
    "T316": {
      "type": "object",
      "properties": {
        "toolName": {
          "type": "string"
        },
        "parameters": {
          "type": "object",
          "additionalProperties": {
            "$ref": "#/$defs/JsonValue"
          }
        },
        "fingerprint": {
          "type": "string"
        }
      },
      "required": [
        "toolName",
        "parameters",
        "fingerprint"
      ],
      "additionalProperties": false
    },
    "T317": {
      "type": "object",
      "properties": {
        "title": {
          "type": "string"
        },
        "fields": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T318"
          }
        }
      },
      "required": [
        "title",
        "fields"
      ],
      "additionalProperties": false
    },
    "T318": {
      "type": "object",
      "properties": {
        "label": {
          "type": "string"
        },
        "value": {
          "type": "string"
        }
      },
      "required": [
        "label",
        "value"
      ],
      "additionalProperties": false
    },
    "T319": {
      "type": "object",
      "properties": {
        "verificationReads": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T312"
          }
        },
        "projectIds": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "observedAt": {
          "type": "string",
          "format": "date-time"
        },
        "resources": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T313"
          }
        },
        "value": {
          "type": "object",
          "additionalProperties": {
            "$ref": "#/$defs/JsonValue"
          }
        },
        "outcome": {
          "type": "string",
          "const": "approval_pending"
        },
        "approval": {
          "$ref": "#/$defs/T320"
        }
      },
      "required": [
        "observedAt",
        "resources",
        "value"
      ],
      "additionalProperties": false
    },
    "T320": {
      "type": "object",
      "properties": {
        "status": {
          "type": "string",
          "const": "PENDING"
        }
      },
      "required": [
        "status"
      ],
      "additionalProperties": false
    },
    "T321": {
      "type": "object",
      "properties": {
        "pageId": {
          "type": "string"
        },
        "projectId": {
          "type": "string"
        },
        "projectName": {
          "type": "string"
        },
        "title": {
          "type": "string"
        },
        "headingPath": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "snippet": {
          "type": "string"
        }
      },
      "required": [
        "pageId",
        "projectId",
        "projectName",
        "title",
        "headingPath",
        "snippet"
      ],
      "additionalProperties": false
    },
    "T322": {
      "type": "object",
      "properties": {
        "projectIds": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "projectCount": {
          "type": "integer"
        }
      },
      "required": [
        "projectIds",
        "projectCount"
      ],
      "additionalProperties": false
    },
    "T323": {
      "type": "object",
      "properties": {
        "items": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T305"
          }
        },
        "total": {
          "type": "integer"
        },
        "page": {
          "type": "integer"
        },
        "pageSize": {
          "type": "integer"
        }
      },
      "required": [
        "items",
        "total",
        "page",
        "pageSize"
      ],
      "additionalProperties": false
    },
    "T324": {
      "type": "object",
      "properties": {
        "conversation": {
          "$ref": "#/$defs/T305"
        },
        "messages": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T306"
          }
        },
        "hasMore": {
          "type": "boolean"
        }
      },
      "required": [
        "conversation",
        "messages",
        "hasMore"
      ],
      "additionalProperties": false
    },
    "T325": {
      "type": "object",
      "properties": {
        "items": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T326"
          }
        }
      },
      "required": [
        "items"
      ],
      "additionalProperties": false
    },
    "T326": {
      "type": "object",
      "properties": {
        "archived": {
          "anyOf": [
            {
              "type": "boolean",
              "const": false
            },
            {
              "type": "boolean",
              "const": true
            }
          ]
        },
        "id": {
          "type": "string"
        },
        "key": {
          "type": "string"
        },
        "name": {
          "type": "string"
        }
      },
      "required": [
        "id",
        "key",
        "name"
      ],
      "additionalProperties": false
    },
    "T327": {
      "type": "object",
      "properties": {
        "mode": {
          "type": "string",
          "enum": [
            "vector",
            "keyword"
          ]
        },
        "hits": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T328"
          }
        },
        "note": {
          "type": "string"
        },
        "scope": {
          "$ref": "#/$defs/T322"
        }
      },
      "required": [
        "mode",
        "hits",
        "scope"
      ],
      "additionalProperties": false
    },
    "T328": {
      "type": "object",
      "properties": {
        "chunkId": {
          "type": "string"
        },
        "score": {
          "type": "number"
        },
        "mode": {
          "type": "string",
          "enum": [
            "vector",
            "keyword"
          ]
        },
        "pageId": {
          "type": "string"
        },
        "projectId": {
          "type": "string"
        },
        "projectName": {
          "type": "string"
        },
        "title": {
          "type": "string"
        },
        "headingPath": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "snippet": {
          "type": "string"
        }
      },
      "required": [
        "chunkId",
        "score",
        "mode",
        "pageId",
        "projectId",
        "projectName",
        "title",
        "headingPath",
        "snippet"
      ],
      "additionalProperties": false
    },
    "T329": {
      "type": "object",
      "properties": {
        "ok": {
          "type": "boolean"
        },
        "server": {
          "type": "string"
        }
      },
      "required": [
        "ok",
        "server"
      ],
      "additionalProperties": false
    },
    "T330": {
      "type": "object",
      "properties": {
        "roomId": {
          "type": "string"
        },
        "resourceType": {
          "type": "string"
        },
        "resourceId": {
          "type": "string"
        },
        "projectId": {
          "type": "string"
        },
        "mode": {
          "type": "string"
        },
        "baseRevisionId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "sequence": {
          "type": "number"
        },
        "canWrite": {
          "type": "boolean"
        },
        "rag": {
          "$ref": "#/$defs/T331"
        },
        "actions": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "domainTools": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "domainAuthorization": {
          "type": "string"
        }
      },
      "required": [
        "roomId",
        "resourceType",
        "resourceId",
        "projectId",
        "mode",
        "baseRevisionId",
        "sequence",
        "canWrite",
        "rag",
        "actions",
        "domainTools",
        "domainAuthorization"
      ],
      "additionalProperties": false
    },
    "T331": {
      "type": "object",
      "properties": {
        "source": {
          "type": "string"
        },
        "publishedRevisionId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        }
      },
      "required": [
        "source",
        "publishedRevisionId"
      ],
      "additionalProperties": false
    },
    "T332": {
      "type": "object",
      "properties": {
        "member": {
          "$ref": "#/$defs/T333"
        },
        "tokenTier": {
          "type": "string",
          "enum": [
            "READ_ONLY",
            "READ_WRITE",
            "ADMIN"
          ]
        },
        "projectWhitelist": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "permissions": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "timezone": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "locale": {
          "type": "string"
        },
        "visibleProjects": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "id": {
                "type": "string"
              },
              "key": {
                "type": "string"
              },
              "name": {
                "type": "string"
              }
            },
            "required": [
              "id",
              "key",
              "name"
            ],
            "additionalProperties": false
          }
        }
      },
      "required": [
        "member",
        "tokenTier",
        "projectWhitelist",
        "permissions",
        "timezone",
        "locale",
        "visibleProjects"
      ],
      "additionalProperties": false
    },
    "T333": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "username": {
          "type": "string"
        },
        "name": {
          "type": "string"
        }
      },
      "required": [
        "id",
        "username",
        "name"
      ],
      "additionalProperties": false
    },
    "T334": {
      "type": "object",
      "properties": {
        "id": {
          "$ref": "#/$defs/JsonValue"
        },
        "key": {
          "$ref": "#/$defs/JsonValue"
        },
        "name": {
          "$ref": "#/$defs/JsonValue"
        }
      },
      "required": [
        "id",
        "key",
        "name"
      ],
      "additionalProperties": false
    },
    "T335": {
      "type": "object",
      "properties": {
        "items": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T336"
          }
        },
        "total": {
          "type": "integer"
        }
      },
      "required": [
        "items",
        "total"
      ],
      "additionalProperties": false
    },
    "T336": {
      "type": "object",
      "properties": {
        "id": {
          "$ref": "#/$defs/JsonValue"
        },
        "key": {
          "$ref": "#/$defs/JsonValue"
        },
        "name": {
          "$ref": "#/$defs/JsonValue"
        },
        "status": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "$ref": "#/$defs/T337"
            }
          ]
        },
        "workItemCount": {
          "type": "integer"
        }
      },
      "required": [
        "id",
        "key",
        "name",
        "status",
        "workItemCount"
      ],
      "additionalProperties": false
    },
    "T337": {
      "type": "object",
      "properties": {
        "key": {
          "$ref": "#/$defs/JsonValue"
        },
        "name": {
          "$ref": "#/$defs/JsonValue"
        },
        "category": {
          "$ref": "#/$defs/JsonValue"
        }
      },
      "required": [
        "key",
        "name",
        "category"
      ],
      "additionalProperties": false
    },
    "T338": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "key": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "description": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "leadMemberId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "status": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "$ref": "#/$defs/T339"
            }
          ]
        },
        "departmentId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "department": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "$ref": "#/$defs/T340"
            }
          ]
        },
        "archivedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "updatedAt": {
          "type": "string",
          "format": "date-time"
        },
        "statusDefs": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T341"
          }
        },
        "workflows": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T342"
          }
        }
      },
      "required": [
        "id",
        "key",
        "name",
        "description",
        "leadMemberId",
        "status",
        "departmentId",
        "department",
        "archivedAt",
        "createdAt",
        "updatedAt",
        "statusDefs",
        "workflows"
      ],
      "additionalProperties": false
    },
    "T339": {
      "type": "object",
      "properties": {
        "key": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "category": {
          "type": "string"
        },
        "color": {
          "type": "string"
        }
      },
      "required": [
        "key",
        "name",
        "category",
        "color"
      ],
      "additionalProperties": false
    },
    "T340": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "name": {
          "type": "string"
        }
      },
      "required": [
        "id",
        "name"
      ],
      "additionalProperties": false
    },
    "T341": {
      "type": "object",
      "properties": {
        "key": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "category": {
          "type": "string"
        },
        "color": {
          "type": "string"
        }
      },
      "required": [
        "key",
        "name",
        "category",
        "color"
      ],
      "additionalProperties": false
    },
    "T342": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "appliesToType": {
          "type": "string"
        },
        "isDefault": {
          "type": "boolean"
        },
        "states": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T343"
          }
        }
      },
      "required": [
        "id",
        "name",
        "appliesToType",
        "isDefault",
        "states"
      ],
      "additionalProperties": false
    },
    "T343": {
      "type": "object",
      "properties": {
        "key": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "category": {
          "type": "string"
        },
        "color": {
          "type": "string"
        }
      },
      "required": [
        "key",
        "name",
        "category",
        "color"
      ],
      "additionalProperties": false
    },
    "T344": {
      "type": "object",
      "properties": {
        "members": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T345"
          }
        }
      },
      "required": [
        "members"
      ],
      "additionalProperties": false
    },
    "T345": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "username": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "role_key": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "role_name": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        }
      },
      "required": [
        "id",
        "username",
        "name",
        "role_key",
        "role_name"
      ],
      "additionalProperties": false
    },
    "T346": {
      "type": "object",
      "properties": {
        "items": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T347"
          }
        },
        "total": {
          "type": "integer"
        },
        "page": {
          "type": "integer"
        },
        "pageSize": {
          "type": "integer"
        }
      },
      "required": [
        "items",
        "total",
        "page",
        "pageSize"
      ],
      "additionalProperties": false
    },
    "T347": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "key": {
          "type": "string"
        },
        "number": {
          "type": "integer"
        },
        "title": {
          "type": "string"
        },
        "type": {
          "type": "string"
        },
        "priority": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "severity": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "assigneeId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "statusId": {
          "type": "string"
        },
        "projectId": {
          "type": "string"
        },
        "workflowId": {
          "type": "string"
        },
        "statusKey": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "statusName": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "statusCategory": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "startDate": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
            }
          ]
        },
        "dueDate": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
            }
          ]
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "updatedAt": {
          "type": "string",
          "format": "date-time"
        },
        "version": {
          "type": "integer"
        },
        "milestoneId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "iterationId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "releaseId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "moduleId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        }
      },
      "required": [
        "id",
        "key",
        "number",
        "title",
        "type",
        "priority",
        "severity",
        "assigneeId",
        "statusId",
        "projectId",
        "workflowId",
        "statusKey",
        "statusName",
        "statusCategory",
        "startDate",
        "dueDate",
        "createdAt",
        "updatedAt",
        "version",
        "milestoneId",
        "iterationId",
        "releaseId",
        "moduleId"
      ],
      "additionalProperties": false
    },
    "T348": {
      "type": "object",
      "properties": {
        "workItem": {
          "$ref": "#/$defs/T349"
        },
        "allowedTransitions": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T350"
          }
        }
      },
      "required": [
        "workItem",
        "allowedTransitions"
      ],
      "additionalProperties": false
    },
    "T349": {
      "type": "object",
      "properties": {
        "statusKey": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "statusName": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "statusCategory": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "id": {
          "type": "string"
        },
        "projectId": {
          "type": "string"
        },
        "number": {
          "type": "integer"
        },
        "key": {
          "type": "string"
        },
        "type": {
          "type": "string"
        },
        "title": {
          "type": "string"
        },
        "description": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "workflowId": {
          "type": "string"
        },
        "statusId": {
          "type": "string"
        },
        "parentId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "milestoneId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "iterationId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "releaseId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "moduleId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "assigneeId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "reporterId": {
          "type": "string"
        },
        "priority": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "severity": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "estimatePoints": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "estimateHours": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "startDate": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
            }
          ]
        },
        "dueDate": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
            }
          ]
        },
        "completedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "version": {
          "type": "integer"
        },
        "deletedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "updatedAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "statusKey",
        "statusName",
        "statusCategory",
        "id",
        "projectId",
        "number",
        "key",
        "type",
        "title",
        "description",
        "workflowId",
        "statusId",
        "parentId",
        "milestoneId",
        "iterationId",
        "releaseId",
        "moduleId",
        "assigneeId",
        "reporterId",
        "priority",
        "severity",
        "estimatePoints",
        "estimateHours",
        "startDate",
        "dueDate",
        "completedAt",
        "version",
        "deletedAt",
        "createdAt",
        "updatedAt"
      ],
      "additionalProperties": false
    },
    "T350": {
      "type": "object",
      "properties": {
        "toStateKey": {
          "type": "string"
        },
        "toName": {
          "type": "string"
        },
        "toCategory": {
          "type": "string"
        },
        "label": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "requiredFields": {
          "type": "array",
          "items": {
            "type": "string"
          }
        }
      },
      "required": [
        "toStateKey",
        "toName",
        "toCategory",
        "label",
        "requiredFields"
      ],
      "additionalProperties": false
    },
    "T351": {
      "type": "object",
      "properties": {
        "comments": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T18"
          }
        }
      },
      "required": [
        "comments"
      ],
      "additionalProperties": false
    },
    "T352": {
      "type": "object",
      "properties": {
        "milestones": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T353"
          }
        }
      },
      "required": [
        "milestones"
      ],
      "additionalProperties": false
    },
    "T353": {
      "type": "object",
      "properties": {
        "projectId": {
          "type": "string"
        },
        "id": {
          "type": "string"
        },
        "description": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "name": {
          "type": "string"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "updatedAt": {
          "type": "string",
          "format": "date-time"
        },
        "sortOrder": {
          "type": "integer"
        },
        "archivedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "startDate": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
            }
          ]
        },
        "dueDate": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
            }
          ]
        },
        "progressMode": {
          "type": "string"
        },
        "progressValue": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "completedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        }
      },
      "required": [
        "projectId",
        "id",
        "description",
        "name",
        "createdAt",
        "updatedAt",
        "sortOrder",
        "archivedAt",
        "startDate",
        "dueDate",
        "progressMode",
        "progressValue",
        "completedAt"
      ],
      "additionalProperties": false
    },
    "T354": {
      "type": "object",
      "properties": {
        "milestone": {
          "$ref": "#/$defs/T278"
        },
        "workItems": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T347"
          }
        }
      },
      "required": [
        "milestone",
        "workItems"
      ],
      "additionalProperties": false
    },
    "T355": {
      "type": "object",
      "properties": {
        "iterations": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T356"
          }
        }
      },
      "required": [
        "iterations"
      ],
      "additionalProperties": false
    },
    "T356": {
      "type": "object",
      "properties": {
        "projectId": {
          "type": "string"
        },
        "id": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "sortOrder": {
          "type": "integer"
        },
        "archivedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "startDate": {
          "type": "string",
          "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
        },
        "completedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "endDate": {
          "type": "string",
          "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
        },
        "completionResult": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "$ref": "#/$defs/T261"
            }
          ]
        },
        "carryOver": {
          "type": "boolean"
        },
        "pendingWorkItemCount": {
          "type": "integer"
        }
      },
      "required": [
        "projectId",
        "id",
        "name",
        "sortOrder",
        "archivedAt",
        "startDate",
        "completedAt",
        "endDate",
        "completionResult",
        "carryOver",
        "pendingWorkItemCount"
      ],
      "additionalProperties": false
    },
    "T357": {
      "type": "object",
      "properties": {
        "releases": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T358"
          }
        }
      },
      "required": [
        "releases"
      ],
      "additionalProperties": false
    },
    "T358": {
      "type": "object",
      "properties": {
        "projectId": {
          "type": "string"
        },
        "id": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "sortOrder": {
          "type": "integer"
        },
        "archivedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "completedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "completionResult": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "$ref": "#/$defs/T261"
            }
          ]
        },
        "versionTag": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "releaseDate": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
            }
          ]
        },
        "notes": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "pendingWorkItemCount": {
          "type": "integer"
        }
      },
      "required": [
        "projectId",
        "id",
        "name",
        "sortOrder",
        "archivedAt",
        "completedAt",
        "completionResult",
        "versionTag",
        "releaseDate",
        "notes",
        "pendingWorkItemCount"
      ],
      "additionalProperties": false
    },
    "T359": {
      "type": "object",
      "properties": {
        "items": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T360"
          }
        },
        "unreadCount": {
          "type": "integer"
        }
      },
      "required": [
        "items",
        "unreadCount"
      ],
      "additionalProperties": false
    },
    "T360": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "recipientId": {
          "type": "string"
        },
        "actorId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "type": {
          "type": "string"
        },
        "category": {
          "type": "string"
        },
        "title": {
          "type": "string"
        },
        "body": {
          "type": "string"
        },
        "link": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "readAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "groupKey": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "itemCount": {
          "type": "integer"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "recipientId",
        "actorId",
        "type",
        "category",
        "title",
        "body",
        "link",
        "readAt",
        "groupKey",
        "itemCount",
        "createdAt"
      ],
      "additionalProperties": false
    },
    "T361": {
      "type": "object",
      "properties": {
        "items": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T362"
          }
        },
        "total": {
          "type": "integer"
        },
        "page": {
          "type": "integer"
        },
        "pageSize": {
          "type": "integer"
        }
      },
      "required": [
        "items",
        "total",
        "page",
        "pageSize"
      ],
      "additionalProperties": false
    },
    "T362": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "projectId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "actorId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "targetType": {
          "type": "string"
        },
        "targetId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "action": {
          "type": "string"
        },
        "summary": {
          "type": "string"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "projectId",
        "actorId",
        "targetType",
        "targetId",
        "action",
        "summary",
        "createdAt"
      ],
      "additionalProperties": false
    },
    "T363": {
      "type": "object",
      "properties": {
        "projectId": {
          "type": "string"
        },
        "workflows": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T364"
          }
        }
      },
      "required": [
        "projectId",
        "workflows"
      ],
      "additionalProperties": false
    },
    "T364": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "appliesToType": {
          "type": "string"
        },
        "isDefault": {
          "type": "boolean"
        },
        "states": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T365"
          }
        },
        "transitions": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T366"
          }
        }
      },
      "required": [
        "id",
        "name",
        "appliesToType",
        "isDefault",
        "states",
        "transitions"
      ],
      "additionalProperties": false
    },
    "T365": {
      "type": "object",
      "properties": {
        "key": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "category": {
          "type": "string"
        },
        "color": {
          "type": "string"
        },
        "sortOrder": {
          "type": "integer"
        }
      },
      "required": [
        "key",
        "name",
        "category",
        "color",
        "sortOrder"
      ],
      "additionalProperties": false
    },
    "T366": {
      "type": "object",
      "properties": {
        "from": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "to": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "allowedRoleIds": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "requiredFields": {
          "type": "array",
          "items": {
            "type": "string"
          }
        }
      },
      "required": [
        "from",
        "to",
        "allowedRoleIds",
        "requiredFields"
      ],
      "additionalProperties": false
    },
    "T367": {
      "type": "object",
      "properties": {
        "pages": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T368"
          }
        }
      },
      "required": [
        "pages"
      ],
      "additionalProperties": false
    },
    "T368": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "title": {
          "type": "string"
        },
        "slug": {
          "type": "string"
        },
        "parentId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "visibility": {
          "type": "string"
        },
        "sortOrder": {
          "type": "integer"
        },
        "currentRevisionId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "updatedAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "title",
        "slug",
        "parentId",
        "visibility",
        "sortOrder",
        "currentRevisionId",
        "updatedAt"
      ],
      "additionalProperties": false
    },
    "T369": {
      "type": "object",
      "properties": {
        "content": {
          "type": "string"
        },
        "revisionNo": {
          "type": "integer"
        },
        "changeSummary": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "id": {
          "type": "string"
        },
        "projectId": {
          "type": "string"
        },
        "title": {
          "type": "string"
        },
        "slug": {
          "type": "string"
        },
        "parentId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "visibility": {
          "type": "string"
        },
        "sortOrder": {
          "type": "integer"
        },
        "searchVector": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "currentRevisionId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "deletedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "updatedAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "content",
        "revisionNo",
        "changeSummary",
        "id",
        "projectId",
        "title",
        "slug",
        "parentId",
        "visibility",
        "sortOrder",
        "searchVector",
        "currentRevisionId",
        "deletedAt",
        "createdAt",
        "updatedAt"
      ],
      "additionalProperties": false
    },
    "T370": {
      "type": "object",
      "properties": {
        "mode": {
          "type": "string"
        },
        "hits": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T371"
          }
        },
        "note": {
          "type": "string"
        }
      },
      "required": [
        "mode",
        "hits"
      ],
      "additionalProperties": false
    },
    "T371": {
      "type": "object",
      "properties": {
        "chunkId": {
          "type": "string"
        },
        "pageId": {
          "type": "string"
        },
        "title": {
          "type": "string"
        },
        "headingPath": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "snippet": {
          "type": "string"
        },
        "score": {
          "type": "number"
        },
        "mode": {
          "type": "string",
          "enum": [
            "vector",
            "keyword"
          ]
        }
      },
      "required": [
        "chunkId",
        "pageId",
        "title",
        "headingPath",
        "snippet",
        "score",
        "mode"
      ],
      "additionalProperties": false
    },
    "T372": {
      "type": "object",
      "properties": {
        "ok": {
          "type": "boolean"
        },
        "answer": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "citations": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T373"
          }
        },
        "mode": {
          "type": "string",
          "enum": [
            "vector",
            "keyword",
            "none"
          ]
        },
        "note": {
          "type": "string"
        }
      },
      "required": [
        "ok",
        "answer",
        "citations",
        "mode"
      ],
      "additionalProperties": false
    },
    "T373": {
      "type": "object",
      "properties": {
        "pageId": {
          "type": "string"
        },
        "title": {
          "type": "string"
        },
        "headingPath": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "snippet": {
          "type": "string"
        }
      },
      "required": [
        "pageId",
        "title",
        "headingPath",
        "snippet"
      ],
      "additionalProperties": false
    },
    "T374": {
      "type": "object",
      "properties": {
        "fields": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T375"
          }
        },
        "schemas": {
          "$ref": "#/$defs/T376"
        },
        "note": {
          "type": "string"
        }
      },
      "required": [
        "fields",
        "schemas",
        "note"
      ],
      "additionalProperties": false
    },
    "T375": {
      "type": "object",
      "properties": {
        "note": {
          "type": "string"
        },
        "required": {
          "type": "boolean"
        },
        "nullable": {
          "type": "boolean"
        },
        "schema": {
          "type": "object",
          "additionalProperties": {
            "$ref": "#/$defs/JsonValue"
          }
        },
        "maxLength": {
          "type": "integer",
          "minimum": 1
        },
        "values": {
          "$ref": "#/$defs/JsonValue"
        },
        "name": {
          "type": "string"
        },
        "type": {
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "array",
              "items": {
                "type": "string"
              }
            }
          ]
        }
      },
      "required": [
        "required",
        "nullable",
        "schema",
        "name",
        "type"
      ],
      "additionalProperties": false
    },
    "T376": {
      "type": "object",
      "properties": {
        "create": {
          "type": "object",
          "additionalProperties": {
            "$ref": "#/$defs/JsonValue"
          }
        },
        "update": {
          "type": "object",
          "additionalProperties": {
            "$ref": "#/$defs/JsonValue"
          }
        }
      },
      "required": [
        "create",
        "update"
      ],
      "additionalProperties": false
    },
    "T377": {
      "type": "object",
      "properties": {
        "sla": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "$ref": "#/$defs/T378"
            }
          ]
        }
      },
      "required": [
        "sla"
      ],
      "additionalProperties": false
    },
    "T378": {
      "type": "object",
      "properties": {
        "policy": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "$ref": "#/$defs/T120"
            }
          ]
        },
        "id": {
          "type": "string"
        },
        "workItemId": {
          "type": "string"
        },
        "policyId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "startedAt": {
          "type": "string",
          "format": "date-time"
        },
        "firstResponseAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "responseDueAt": {
          "type": "string",
          "format": "date-time"
        },
        "resolveDueAt": {
          "type": "string",
          "format": "date-time"
        },
        "breachedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "state": {
          "type": "string"
        },
        "pausedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "pausedMs": {
          "type": "integer"
        },
        "lastEscalatedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "updatedAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "policy",
        "id",
        "workItemId",
        "policyId",
        "startedAt",
        "firstResponseAt",
        "responseDueAt",
        "resolveDueAt",
        "breachedAt",
        "state",
        "pausedAt",
        "pausedMs",
        "lastEscalatedAt",
        "createdAt",
        "updatedAt"
      ],
      "additionalProperties": false
    },
    "T379": {
      "type": "object",
      "properties": {
        "approvals": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T380"
          }
        }
      },
      "required": [
        "approvals"
      ],
      "additionalProperties": false
    },
    "T380": {
      "type": "object",
      "properties": {
        "fromStateName": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "toStateName": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "id": {
          "type": "string"
        },
        "workItemId": {
          "type": "string"
        },
        "workflowId": {
          "type": "string"
        },
        "fromStateId": {
          "type": "string"
        },
        "toStateId": {
          "type": "string"
        },
        "requestedBy": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "approverRoleKeys": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "transitionFields": {
          "type": "object",
          "additionalProperties": {
            "$ref": "#/$defs/JsonValue"
          }
        },
        "status": {
          "type": "string"
        },
        "comment": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "decidedBy": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "decidedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "fromStateName",
        "toStateName",
        "id",
        "workItemId",
        "workflowId",
        "fromStateId",
        "toStateId",
        "requestedBy",
        "approverRoleKeys",
        "transitionFields",
        "status",
        "comment",
        "decidedBy",
        "decidedAt",
        "createdAt"
      ],
      "additionalProperties": false
    },
    "T381": {
      "type": "object",
      "properties": {
        "rules": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T382"
          }
        }
      },
      "required": [
        "rules"
      ],
      "additionalProperties": false
    },
    "T382": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "projectId": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "enabled": {
          "type": "boolean"
        },
        "trigger": {
          "type": "string"
        },
        "conditions": {
          "$ref": "#/$defs/JsonValue"
        },
        "actions": {
          "$ref": "#/$defs/JsonValue"
        },
        "scheduleCron": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "scheduleTimezone": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "lastScheduledAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "scheduleState": {
          "$ref": "#/$defs/JsonValue"
        },
        "createdBy": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "updatedAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "projectId",
        "name",
        "enabled",
        "trigger",
        "conditions",
        "actions",
        "scheduleCron",
        "scheduleTimezone",
        "lastScheduledAt",
        "scheduleState",
        "createdBy",
        "createdAt",
        "updatedAt"
      ],
      "additionalProperties": false
    },
    "T383": {
      "type": "object",
      "properties": {
        "runs": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T384"
          }
        }
      },
      "required": [
        "runs"
      ],
      "additionalProperties": false
    },
    "T384": {
      "type": "object",
      "properties": {
        "run": {
          "$ref": "#/$defs/T385"
        },
        "ruleName": {
          "type": "string"
        }
      },
      "required": [
        "run",
        "ruleName"
      ],
      "additionalProperties": false
    },
    "T385": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "ruleId": {
          "type": "string"
        },
        "workItemId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "trigger": {
          "type": "string"
        },
        "status": {
          "type": "string"
        },
        "actions": {
          "$ref": "#/$defs/JsonValue"
        },
        "error": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "ruleId",
        "workItemId",
        "trigger",
        "status",
        "actions",
        "error",
        "createdAt"
      ],
      "additionalProperties": false
    },
    "T386": {
      "type": "object",
      "properties": {
        "portfolios": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T222"
          }
        }
      },
      "required": [
        "portfolios"
      ],
      "additionalProperties": false
    },
    "T387": {
      "type": "object",
      "properties": {
        "ok": {
          "type": "boolean"
        }
      },
      "required": [
        "ok"
      ],
      "additionalProperties": false
    },
    "T388": {
      "type": "object",
      "properties": {
        "forms": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T145"
          }
        }
      },
      "required": [
        "forms"
      ],
      "additionalProperties": false
    },
    "T389": {
      "type": "object",
      "properties": {
        "form": {
          "$ref": "#/$defs/T148"
        },
        "submitToken": {
          "type": "string"
        }
      },
      "required": [
        "form",
        "submitToken"
      ],
      "additionalProperties": false
    },
    "T390": {
      "type": "object",
      "properties": {
        "submitToken": {
          "type": "string"
        }
      },
      "required": [
        "submitToken"
      ],
      "additionalProperties": false
    },
    "T391": {
      "type": "object",
      "properties": {
        "ok": {
          "type": "boolean"
        }
      },
      "required": [
        "ok"
      ],
      "additionalProperties": false
    },
    "T392": {
      "type": "object",
      "properties": {
        "ok": {
          "type": "boolean"
        }
      },
      "required": [
        "ok"
      ],
      "additionalProperties": false
    },
    "T393": {
      "type": "object",
      "properties": {
        "todos": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T170"
          }
        }
      },
      "required": [
        "todos"
      ],
      "additionalProperties": false
    },
    "T394": {
      "type": "object",
      "properties": {
        "ok": {
          "type": "boolean"
        }
      },
      "required": [
        "ok"
      ],
      "additionalProperties": false
    },
    "T395": {
      "type": "object",
      "properties": {
        "blocks": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T173"
          }
        }
      },
      "required": [
        "blocks"
      ],
      "additionalProperties": false
    },
    "T396": {
      "type": "object",
      "properties": {
        "ok": {
          "type": "boolean"
        }
      },
      "required": [
        "ok"
      ],
      "additionalProperties": false
    },
    "T397": {
      "type": "object",
      "properties": {
        "sessions": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T174"
          }
        }
      },
      "required": [
        "sessions"
      ],
      "additionalProperties": false
    },
    "T398": {
      "type": "object",
      "properties": {
        "views": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T275"
          }
        }
      },
      "required": [
        "views"
      ],
      "additionalProperties": false
    },
    "T399": {
      "type": "object",
      "properties": {
        "projectId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "id": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "updatedAt": {
          "type": "string",
          "format": "date-time"
        },
        "sortOrder": {
          "type": "integer"
        },
        "ownerId": {
          "type": "string"
        },
        "scope": {
          "type": "string"
        },
        "viewType": {
          "type": "string"
        },
        "filters": {
          "$ref": "#/$defs/JsonValue"
        },
        "sorts": {
          "$ref": "#/$defs/JsonValue"
        },
        "isPinned": {
          "type": "boolean"
        }
      },
      "required": [
        "projectId",
        "id",
        "name",
        "createdAt",
        "updatedAt",
        "sortOrder",
        "ownerId",
        "scope",
        "viewType",
        "filters",
        "sorts",
        "isPinned"
      ],
      "additionalProperties": false
    },
    "T400": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "ownerId": {
          "type": "string"
        },
        "scope": {
          "type": "string"
        },
        "projectId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "viewType": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "filters": {
          "$ref": "#/$defs/JsonValue"
        },
        "sorts": {
          "$ref": "#/$defs/JsonValue"
        },
        "isPinned": {
          "type": "boolean"
        },
        "sortOrder": {
          "type": "integer"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "updatedAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "ownerId",
        "scope",
        "projectId",
        "viewType",
        "name",
        "filters",
        "sorts",
        "isPinned",
        "sortOrder",
        "createdAt",
        "updatedAt"
      ],
      "additionalProperties": false
    },
    "T401": {
      "type": "object",
      "properties": {
        "ok": {
          "type": "boolean"
        }
      },
      "required": [
        "ok"
      ],
      "additionalProperties": false
    },
    "T402": {
      "type": "object",
      "properties": {
        "ok": {
          "type": "boolean"
        }
      },
      "required": [
        "ok"
      ],
      "additionalProperties": false
    },
    "T403": {
      "type": "object",
      "properties": {
        "dashboards": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T201"
          }
        }
      },
      "required": [
        "dashboards"
      ],
      "additionalProperties": false
    },
    "T404": {
      "type": "object",
      "properties": {
        "ok": {
          "type": "boolean"
        }
      },
      "required": [
        "ok"
      ],
      "additionalProperties": false
    },
    "T405": {
      "type": "object",
      "properties": {
        "widgets": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T203"
          }
        }
      },
      "required": [
        "widgets"
      ],
      "additionalProperties": false
    },
    "T406": {
      "type": "object",
      "properties": {
        "ok": {
          "type": "boolean"
        }
      },
      "required": [
        "ok"
      ],
      "additionalProperties": false
    },
    "T407": {
      "type": "object",
      "properties": {
        "data": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "$ref": "#/$defs/T189"
            },
            {
              "$ref": "#/$defs/T192"
            },
            {
              "$ref": "#/$defs/T209"
            },
            {
              "$ref": "#/$defs/T210"
            },
            {
              "$ref": "#/$defs/T212"
            },
            {
              "$ref": "#/$defs/T215"
            },
            {
              "$ref": "#/$defs/T218"
            }
          ]
        }
      },
      "required": [
        "data"
      ],
      "additionalProperties": false
    },
    "T408": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "$ref": "#/$defs/JsonValue"
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "T409": {
      "type": "object",
      "properties": {
        "sequence": {
          "type": "number"
        },
        "duplicate": {
          "type": "boolean"
        },
        "stateVectorHash": {
          "type": "string"
        }
      },
      "required": [
        "sequence",
        "duplicate",
        "stateVectorHash"
      ],
      "additionalProperties": false
    },
    "T410": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "$ref": "#/$defs/T411"
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "T411": {
      "type": "object",
      "properties": {
        "page": {
          "$ref": "#/$defs/T412"
        },
        "sequence": {
          "type": "number"
        },
        "publishedRevisionId": {
          "type": "string"
        },
        "indexing": {
          "anyOf": [
            {
              "$ref": "#/$defs/T413"
            },
            {
              "$ref": "#/$defs/T414"
            },
            {
              "$ref": "#/$defs/T415"
            }
          ]
        }
      },
      "required": [
        "page",
        "sequence",
        "publishedRevisionId",
        "indexing"
      ],
      "additionalProperties": false
    },
    "T412": {
      "type": "object",
      "properties": {
        "content": {
          "type": "string"
        },
        "revisionNo": {
          "type": "integer"
        },
        "id": {
          "type": "string"
        },
        "projectId": {
          "type": "string"
        },
        "title": {
          "type": "string"
        },
        "slug": {
          "type": "string"
        },
        "parentId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "visibility": {
          "type": "string"
        },
        "sortOrder": {
          "type": "integer"
        },
        "searchVector": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "currentRevisionId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "deletedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "updatedAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "content",
        "revisionNo",
        "id",
        "projectId",
        "title",
        "slug",
        "parentId",
        "visibility",
        "sortOrder",
        "searchVector",
        "currentRevisionId",
        "deletedAt",
        "createdAt",
        "updatedAt"
      ],
      "additionalProperties": false
    },
    "T413": {
      "type": "object",
      "properties": {
        "status": {
          "type": "string",
          "const": "SUCCEEDED"
        },
        "jobId": {
          "type": "string"
        },
        "generation": {
          "type": "number"
        },
        "embedded": {
          "type": "number"
        }
      },
      "required": [
        "status",
        "jobId",
        "generation",
        "embedded"
      ],
      "additionalProperties": false
    },
    "T414": {
      "type": "object",
      "properties": {
        "status": {
          "type": "string",
          "const": "FAILED"
        },
        "message": {
          "type": "string"
        }
      },
      "required": [
        "status",
        "message"
      ],
      "additionalProperties": false
    },
    "T415": {
      "type": "object",
      "properties": {
        "status": {
          "type": "string",
          "const": "QUEUED"
        }
      },
      "required": [
        "status"
      ],
      "additionalProperties": false
    },
    "T416": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "$ref": "#/$defs/T8"
            }
          ]
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "T417": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "$ref": "#/$defs/T8"
            }
          ]
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "T418": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "$ref": "#/$defs/T19"
        }
      },
      "required": [
        "replayed"
      ],
      "additionalProperties": false
    },
    "T419": {
      "type": "object",
      "properties": {
        "type": {
          "type": "string"
        },
        "projectId": {
          "type": "string"
        },
        "id": {
          "type": "string"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "targetId": {
          "type": "string"
        },
        "sourceId": {
          "type": "string"
        }
      },
      "required": [
        "type",
        "projectId",
        "id",
        "createdAt",
        "targetId",
        "sourceId"
      ],
      "additionalProperties": false
    },
    "T420": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "targetType": {
          "type": "string"
        },
        "targetId": {
          "type": "string"
        },
        "authorId": {
          "type": "string"
        },
        "body": {
          "type": "string"
        },
        "parentId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "editedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "deletedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "updatedAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "targetType",
        "targetId",
        "authorId",
        "body",
        "parentId",
        "editedAt",
        "deletedAt",
        "createdAt",
        "updatedAt"
      ],
      "additionalProperties": false
    },
    "T421": {
      "type": "object",
      "properties": {
        "ok": {
          "type": "boolean"
        }
      },
      "required": [
        "ok"
      ],
      "additionalProperties": false
    },
    "T422": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "$ref": "#/$defs/T154"
        }
      },
      "required": [
        "replayed"
      ],
      "additionalProperties": false
    },
    "T423": {
      "type": "object",
      "properties": {
        "ideaId": {
          "type": "string"
        },
        "weight": {
          "type": "number"
        },
        "score": {
          "type": "string"
        }
      },
      "required": [
        "ideaId",
        "weight",
        "score"
      ],
      "additionalProperties": false
    },
    "T424": {
      "type": "object",
      "properties": {
        "workItem": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "$ref": "#/$defs/T8"
            }
          ]
        },
        "alreadyPromoted": {
          "type": "boolean"
        }
      },
      "required": [
        "workItem",
        "alreadyPromoted"
      ],
      "additionalProperties": false
    },
    "T425": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "$ref": "#/$defs/T426"
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "T426": {
      "type": "object",
      "properties": {
        "currentRevisionId": {
          "type": "string"
        },
        "revisionNo": {
          "type": "integer"
        },
        "projectId": {
          "type": "string"
        },
        "id": {
          "type": "string"
        },
        "title": {
          "type": "string"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "updatedAt": {
          "type": "string",
          "format": "date-time"
        },
        "parentId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "sortOrder": {
          "type": "integer"
        },
        "deletedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "slug": {
          "type": "string"
        },
        "visibility": {
          "type": "string"
        },
        "searchVector": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        }
      },
      "required": [
        "currentRevisionId",
        "revisionNo",
        "projectId",
        "id",
        "title",
        "createdAt",
        "updatedAt",
        "parentId",
        "sortOrder",
        "deletedAt",
        "slug",
        "visibility",
        "searchVector"
      ],
      "additionalProperties": false
    },
    "T427": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "anyOf": [
            {
              "$ref": "#/$defs/T428"
            },
            {
              "$ref": "#/$defs/T278"
            },
            {
              "$ref": "#/$defs/T429"
            },
            {
              "$ref": "#/$defs/T430"
            }
          ]
        }
      },
      "required": [
        "replayed"
      ],
      "additionalProperties": false
    },
    "T428": {
      "type": "object",
      "properties": {
        "projectId": {
          "type": "string"
        },
        "id": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "sortOrder": {
          "type": "integer"
        },
        "archivedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "startDate": {
          "type": "string",
          "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
        },
        "completedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "endDate": {
          "type": "string",
          "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
        },
        "completionResult": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "$ref": "#/$defs/T261"
            }
          ]
        },
        "carryOver": {
          "type": "boolean"
        }
      },
      "required": [
        "projectId",
        "id",
        "name",
        "sortOrder",
        "archivedAt",
        "startDate",
        "completedAt",
        "endDate",
        "completionResult",
        "carryOver"
      ],
      "additionalProperties": false
    },
    "T429": {
      "type": "object",
      "properties": {
        "projectId": {
          "type": "string"
        },
        "id": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "parentId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "sortOrder": {
          "type": "integer"
        },
        "archivedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "leadMemberId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        }
      },
      "required": [
        "projectId",
        "id",
        "name",
        "parentId",
        "sortOrder",
        "archivedAt",
        "leadMemberId"
      ],
      "additionalProperties": false
    },
    "T430": {
      "type": "object",
      "properties": {
        "projectId": {
          "type": "string"
        },
        "id": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "sortOrder": {
          "type": "integer"
        },
        "archivedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "completedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "completionResult": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "$ref": "#/$defs/T261"
            }
          ]
        },
        "versionTag": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "releaseDate": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
            }
          ]
        },
        "notes": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        }
      },
      "required": [
        "projectId",
        "id",
        "name",
        "sortOrder",
        "archivedAt",
        "completedAt",
        "completionResult",
        "versionTag",
        "releaseDate",
        "notes"
      ],
      "additionalProperties": false
    },
    "T431": {
      "type": "object",
      "properties": {
        "ok": {
          "type": "boolean"
        },
        "scope": {
          "type": "string"
        },
        "id": {
          "$ref": "#/$defs/JsonValue"
        }
      },
      "required": [
        "ok",
        "scope",
        "id"
      ],
      "additionalProperties": false
    },
    "T432": {
      "type": "object",
      "properties": {
        "ok": {
          "type": "boolean"
        },
        "scope": {
          "type": "string"
        }
      },
      "required": [
        "ok",
        "scope"
      ],
      "additionalProperties": false
    },
    "T433": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "$ref": "#/$defs/T434"
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "T434": {
      "type": "object",
      "properties": {
        "deliveredCount": {
          "type": "integer"
        },
        "targetCount": {
          "type": "integer"
        },
        "failedCount": {
          "type": "integer"
        },
        "id": {
          "type": "string"
        },
        "title": {
          "type": "string"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "revokedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "severity": {
          "type": "string"
        },
        "authorId": {
          "type": "string"
        },
        "body": {
          "type": "string"
        },
        "audience": {
          "$ref": "#/$defs/JsonValue"
        }
      },
      "required": [
        "deliveredCount",
        "targetCount",
        "failedCount",
        "id",
        "title",
        "createdAt",
        "revokedAt",
        "severity",
        "authorId",
        "body",
        "audience"
      ],
      "additionalProperties": false
    },
    "T435": {
      "type": "object",
      "properties": {
        "alreadyRevoked": {
          "type": "boolean"
        },
        "id": {
          "type": "string"
        },
        "authorId": {
          "type": "string"
        },
        "title": {
          "type": "string"
        },
        "body": {
          "type": "string"
        },
        "severity": {
          "type": "string"
        },
        "audience": {
          "$ref": "#/$defs/JsonValue"
        },
        "deliveredCount": {
          "type": "integer"
        },
        "revokedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "alreadyRevoked",
        "id",
        "authorId",
        "title",
        "body",
        "severity",
        "audience",
        "deliveredCount",
        "revokedAt",
        "createdAt"
      ],
      "additionalProperties": false
    },
    "T436": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "$ref": "#/$defs/T437"
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "T437": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "workItemId": {
          "type": "string"
        },
        "policyId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "startedAt": {
          "type": "string",
          "format": "date-time"
        },
        "firstResponseAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "responseDueAt": {
          "type": "string",
          "format": "date-time"
        },
        "resolveDueAt": {
          "type": "string",
          "format": "date-time"
        },
        "breachedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "state": {
          "type": "string"
        },
        "pausedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "pausedMs": {
          "type": "integer"
        },
        "lastEscalatedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "updatedAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "workItemId",
        "policyId",
        "startedAt",
        "firstResponseAt",
        "responseDueAt",
        "resolveDueAt",
        "breachedAt",
        "state",
        "pausedAt",
        "pausedMs",
        "lastEscalatedAt",
        "createdAt",
        "updatedAt"
      ],
      "additionalProperties": false
    },
    "T438": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "anyOf": [
            {
              "$ref": "#/$defs/T439"
            },
            {
              "$ref": "#/$defs/T440"
            }
          ]
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "T439": {
      "type": "object",
      "properties": {
        "workItemId": {
          "type": "string"
        },
        "id": {
          "type": "string"
        },
        "workflowId": {
          "type": "string"
        },
        "fromStateId": {
          "type": "string"
        },
        "toStateId": {
          "type": "string"
        },
        "requestedBy": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "approverRoleKeys": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "transitionFields": {
          "type": "object",
          "additionalProperties": {
            "$ref": "#/$defs/JsonValue"
          }
        },
        "status": {
          "type": "string"
        },
        "comment": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "decidedBy": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "decidedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "workItemId",
        "id",
        "workflowId",
        "fromStateId",
        "toStateId",
        "requestedBy",
        "approverRoleKeys",
        "transitionFields",
        "status",
        "comment",
        "decidedBy",
        "decidedAt",
        "createdAt"
      ],
      "additionalProperties": false
    },
    "T440": {
      "type": "object",
      "properties": {
        "workItem": {
          "$ref": "#/$defs/T8"
        },
        "id": {
          "type": "string"
        },
        "workItemId": {
          "type": "string"
        },
        "workflowId": {
          "type": "string"
        },
        "fromStateId": {
          "type": "string"
        },
        "toStateId": {
          "type": "string"
        },
        "requestedBy": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "approverRoleKeys": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "transitionFields": {
          "type": "object",
          "additionalProperties": {
            "$ref": "#/$defs/JsonValue"
          }
        },
        "status": {
          "type": "string"
        },
        "comment": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "decidedBy": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "decidedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "workItem",
        "id",
        "workItemId",
        "workflowId",
        "fromStateId",
        "toStateId",
        "requestedBy",
        "approverRoleKeys",
        "transitionFields",
        "status",
        "comment",
        "decidedBy",
        "decidedAt",
        "createdAt"
      ],
      "additionalProperties": false
    },
    "T441": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "$ref": "#/$defs/T442"
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "T442": {
      "type": "object",
      "properties": {
        "projectId": {
          "type": "string"
        },
        "id": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "updatedAt": {
          "type": "string",
          "format": "date-time"
        },
        "actions": {
          "$ref": "#/$defs/JsonValue"
        },
        "createdBy": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "enabled": {
          "type": "boolean"
        },
        "trigger": {
          "type": "string"
        },
        "conditions": {
          "$ref": "#/$defs/JsonValue"
        },
        "scheduleCron": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "scheduleTimezone": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "lastScheduledAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "scheduleState": {
          "$ref": "#/$defs/JsonValue"
        }
      },
      "required": [
        "projectId",
        "id",
        "name",
        "createdAt",
        "updatedAt",
        "actions",
        "createdBy",
        "enabled",
        "trigger",
        "conditions",
        "scheduleCron",
        "scheduleTimezone",
        "lastScheduledAt",
        "scheduleState"
      ],
      "additionalProperties": false
    }
  },
  "sources": {
    "workitem.delete": "src/server/application/capabilities/legacy/work-planning-tools.ts:182",
    "workitem.listProgress": "src/server/application/capabilities/collaboration-tools.ts:36",
    "workitem.addProgress": "src/server/application/capabilities/collaboration-tools.ts:37",
    "workitem.deleteProgress": "src/server/application/capabilities/collaboration-tools.ts:38",
    "workitem.listTransfers": "src/server/application/capabilities/collaboration-tools.ts:39",
    "workitem.transfer": "src/server/application/capabilities/legacy/work-planning-tools.ts:205",
    "workitem.listCollaborators": "src/server/application/capabilities/collaboration-tools.ts:41",
    "workitem.addCollaborator": "src/server/application/capabilities/legacy/collaboration-tools.ts:76",
    "workitem.removeCollaborator": "src/server/application/capabilities/legacy/collaboration-tools.ts:85",
    "workitem.listWatchers": "src/server/application/capabilities/collaboration-tools.ts:44",
    "workitem.follow": "src/server/application/capabilities/legacy/collaboration-tools.ts:27",
    "workitem.unfollow": "src/server/application/capabilities/legacy/collaboration-tools.ts:110",
    "comment.list": "src/server/application/capabilities/collaboration-tools.ts:47",
    "comment.create": "src/server/application/capabilities/collaboration-tools.ts:48",
    "customField.getValues": "src/server/application/capabilities/compatibility-tools.ts:30",
    "customField.setValues": "src/server/application/capabilities/compatibility-tools.ts:31",
    "projectTemplate.list": "src/server/application/capabilities/legacy/project-tools.ts:306",
    "projectTemplate.get": "src/server/application/capabilities/legacy/project-tools.ts:314",
    "projectTemplate.create": "src/server/application/capabilities/legacy/project-tools.ts:322",
    "projectTemplate.update": "src/server/application/capabilities/legacy/project-tools.ts:334",
    "projectTemplate.delete": "src/server/application/capabilities/legacy/project-tools.ts:347",
    "project.createFromTemplate": "src/server/application/capabilities/configuration-tools.ts:27",
    "workflow.list": "src/server/application/capabilities/legacy/operations-tools.ts:34",
    "workflow.create": "src/server/application/capabilities/legacy/operations-tools.ts:35",
    "workflow.update": "src/server/application/capabilities/legacy/operations-tools.ts:36",
    "workflow.listStates": "src/server/application/capabilities/configuration-tools.ts:31",
    "workflow.addState": "src/server/application/capabilities/legacy/operations-tools.ts:38",
    "workflow.updateState": "src/server/application/capabilities/legacy/operations-tools.ts:39",
    "workflow.archiveState": "src/server/application/capabilities/legacy/operations-tools.ts:40",
    "workflow.listTransitions": "src/server/application/capabilities/configuration-tools.ts:35",
    "workflow.addTransition": "src/server/application/capabilities/legacy/operations-tools.ts:42",
    "workflow.updateTransition": "src/server/application/capabilities/legacy/operations-tools.ts:43",
    "workflow.removeTransition": "src/server/application/capabilities/legacy/operations-tools.ts:44",
    "page.revisions": "src/server/application/capabilities/legacy/content-tools.ts:227",
    "page.getRevision": "src/server/application/capabilities/content-tools.ts:48",
    "page.getPermissions": "src/server/application/capabilities/content-tools.ts:58",
    "import.list": "src/server/application/capabilities/legacy/operations-tools.ts:52",
    "import.get": "src/server/application/capabilities/legacy/operations-tools.ts:62",
    "import.suggestions": "src/server/application/capabilities/legacy/operations-tools.ts:74",
    "export.workItems": "src/server/application/capabilities/content-tools.ts:91",
    "export.projectReport": "src/server/application/capabilities/content-tools.ts:96",
    "meta.capabilities": "src/server/application/capabilities/intelligence-tools.ts:29",
    "meta.tool": "src/server/application/capabilities/intelligence-tools.ts:45",
    "project.context": "src/server/application/capabilities/intelligence-tools.ts:50",
    "role.permissions": "src/server/application/capabilities/legacy/administration-tools.ts:17",
    "role.create": "src/server/application/capabilities/organization-tools.ts:112",
    "role.update": "src/server/application/capabilities/organization-tools.ts:114",
    "role.delete": "src/server/application/capabilities/organization-tools.ts:116",
    "role.scopeOptions": "src/server/application/capabilities/legacy/administration-tools.ts:21",
    "role.assignments": "src/server/application/capabilities/legacy/administration-tools.ts:22",
    "role.getAssignment": "src/server/application/capabilities/legacy/administration-tools.ts:23",
    "role.assign": "src/server/application/capabilities/legacy/administration-tools.ts:24",
    "role.updateAssignment": "src/server/application/capabilities/organization-tools.ts:121",
    "role.revoke": "src/server/application/capabilities/legacy/administration-tools.ts:26",
    "organization.departments": "src/server/application/capabilities/legacy/administration-tools.ts:27",
    "organization.createDepartment": "src/server/application/capabilities/legacy/administration-tools.ts:28",
    "organization.updateDepartment": "src/server/application/capabilities/legacy/administration-tools.ts:29",
    "organization.archiveDepartment": "src/server/application/capabilities/legacy/administration-tools.ts:30",
    "organization.positions": "src/server/application/capabilities/legacy/administration-tools.ts:31",
    "organization.createPosition": "src/server/application/capabilities/legacy/administration-tools.ts:32",
    "organization.updatePosition": "src/server/application/capabilities/legacy/administration-tools.ts:33",
    "organization.archivePosition": "src/server/application/capabilities/legacy/administration-tools.ts:34",
    "organization.assignMember": "src/server/application/capabilities/legacy/administration-tools.ts:35",
    "organization.applyTemplate": "src/server/application/capabilities/organization-tools.ts:73",
    "team.list": "src/server/application/capabilities/organization-tools.ts:91",
    "team.members": "src/server/application/capabilities/organization-tools.ts:92",
    "team.create": "src/server/application/capabilities/organization-tools.ts:94",
    "team.update": "src/server/application/capabilities/organization-tools.ts:96",
    "team.delete": "src/server/application/capabilities/organization-tools.ts:98",
    "timeLog.update": "src/server/application/capabilities/legacy/collaboration-tools.ts:51",
    "workitem.collaborators": "src/server/application/capabilities/legacy/collaboration-tools.ts:64",
    "workitem.watchers": "src/server/application/capabilities/legacy/collaboration-tools.ts:100",
    "timeLog.list": "src/server/application/capabilities/legacy/collaboration-tools.ts:118",
    "timeLog.create": "src/server/application/capabilities/legacy/collaboration-tools.ts:127",
    "timeLog.delete": "src/server/application/capabilities/legacy/collaboration-tools.ts:136",
    "workitem.contentLinks": "src/server/application/capabilities/legacy/collaboration-tools.ts:144",
    "workitem.createContentLink": "src/server/application/capabilities/legacy/collaboration-tools.ts:153",
    "workitem.deleteContentLink": "src/server/application/capabilities/legacy/collaboration-tools.ts:161",
    "prefs.get": "src/server/application/capabilities/legacy/collaboration-tools.ts:169",
    "prefs.update": "src/server/application/capabilities/legacy/collaboration-tools.ts:182",
    "sla.listPolicies": "src/server/application/capabilities/legacy/content-tools.ts:118",
    "sla.createPolicy": "src/server/application/capabilities/legacy/content-tools.ts:131",
    "sla.updatePolicy": "src/server/application/capabilities/legacy/content-tools.ts:150",
    "sla.deletePolicy": "src/server/application/capabilities/legacy/content-tools.ts:165",
    "idea.list": "src/server/application/capabilities/legacy/content-tools.ts:183",
    "idea.get": "src/server/application/capabilities/legacy/content-tools.ts:191",
    "idea.update": "src/server/application/capabilities/legacy/content-tools.ts:203",
    "idea.unvote": "src/server/application/capabilities/legacy/content-tools.ts:212",
    "idea.delete": "src/server/application/capabilities/legacy/content-tools.ts:220",
    "page.restore": "src/server/application/capabilities/legacy/content-tools.ts:238",
    "page.delete": "src/server/application/capabilities/legacy/content-tools.ts:249",
    "page.permissions": "src/server/application/capabilities/legacy/content-tools.ts:257",
    "page.setPermissions": "src/server/application/capabilities/legacy/content-tools.ts:271",
    "attachment.download": "src/server/application/capabilities/legacy/content-tools.ts:285",
    "attachment.remove": "src/server/application/capabilities/legacy/content-tools.ts:294",
    "attachment.get": "src/server/application/capabilities/legacy/content-tools.ts:302",
    "automation.updateRule": "src/server/application/capabilities/legacy/content-tools.ts:313",
    "automation.deleteRule": "src/server/application/capabilities/legacy/content-tools.ts:327",
    "automation.testRule": "src/server/application/capabilities/legacy/content-tools.ts:336",
    "notification.getPrefs": "src/server/application/capabilities/legacy/content-tools.ts:350",
    "announcement.list": "src/server/application/capabilities/legacy/content-tools.ts:358",
    "intake.listForms": "src/server/application/capabilities/workspace-tools.ts:213",
    "intake.getForm": "src/server/application/capabilities/legacy/content-tools.ts:381",
    "intake.createForm": "src/server/application/capabilities/workspace-tools.ts:214",
    "intake.updateForm": "src/server/application/capabilities/workspace-tools.ts:215",
    "intake.deleteForm": "src/server/application/capabilities/workspace-tools.ts:217",
    "intake.listSubmissions": "src/server/application/capabilities/workspace-tools.ts:218",
    "intake.convertSubmission": "src/server/application/capabilities/workspace-tools.ts:219",
    "intake.rejectSubmission": "src/server/application/capabilities/workspace-tools.ts:220",
    "workflow.states": "src/server/application/capabilities/legacy/operations-tools.ts:37",
    "workflow.transitions": "src/server/application/capabilities/legacy/operations-tools.ts:41",
    "import.create": "src/server/application/capabilities/legacy/operations-tools.ts:46",
    "import.setMapping": "src/server/application/capabilities/legacy/operations-tools.ts:75",
    "import.dryRun": "src/server/application/capabilities/legacy/operations-tools.ts:76",
    "import.confirm": "src/server/application/capabilities/legacy/operations-tools.ts:77",
    "import.rollback": "src/server/application/capabilities/legacy/operations-tools.ts:78",
    "workbench.get": "src/server/application/capabilities/legacy/operations-tools.ts:80",
    "todo.list": "src/server/application/capabilities/workspace-tools.ts:222",
    "todo.create": "src/server/application/capabilities/workspace-tools.ts:223",
    "todo.update": "src/server/application/capabilities/workspace-tools.ts:224",
    "todo.delete": "src/server/application/capabilities/workspace-tools.ts:225",
    "focus.blocks": "src/server/application/capabilities/legacy/operations-tools.ts:85",
    "focus.getBlock": "src/server/application/capabilities/legacy/operations-tools.ts:86",
    "focus.getSession": "src/server/application/capabilities/legacy/operations-tools.ts:87",
    "focus.createBlock": "src/server/application/capabilities/workspace-tools.ts:228",
    "focus.updateBlock": "src/server/application/capabilities/workspace-tools.ts:229",
    "focus.deleteBlock": "src/server/application/capabilities/workspace-tools.ts:236",
    "focus.sessions": "src/server/application/capabilities/legacy/operations-tools.ts:95",
    "focus.recordSession": "src/server/application/capabilities/workspace-tools.ts:239",
    "focus.updateSession": "src/server/application/capabilities/workspace-tools.ts:240",
    "focus.today": "src/server/application/capabilities/workspace-tools.ts:237",
    "project.create": "src/server/application/capabilities/legacy/project-tools.ts:200",
    "project.update": "src/server/application/capabilities/legacy/project-tools.ts:214",
    "project.archive": "src/server/application/capabilities/legacy/project-tools.ts:226",
    "project.unarchive": "src/server/application/capabilities/legacy/project-tools.ts:234",
    "project.status": "src/server/application/capabilities/legacy/project-tools.ts:241",
    "project.member.add": "src/server/application/capabilities/legacy/project-tools.ts:264",
    "project.member.remove": "src/server/application/capabilities/legacy/project-tools.ts:275",
    "member.list": "src/server/application/capabilities/legacy/project-tools.ts:290",
    "role.list": "src/server/application/capabilities/organization-tools.ts:108",
    "projectTemplate.createProject": "src/server/application/capabilities/legacy/project-tools.ts:360",
    "insight.burnDown": "src/server/application/capabilities/legacy/project-tools.ts:372",
    "insight.cumulativeFlow": "src/server/application/capabilities/workspace-tools.ts:291",
    "insight.projectActivity": "src/server/application/capabilities/legacy/project-tools.ts:400",
    "dashboard.list": "src/server/application/capabilities/workspace-tools.ts:259",
    "dashboard.get": "src/server/application/capabilities/workspace-tools.ts:263",
    "dashboard.create": "src/server/application/capabilities/workspace-tools.ts:268",
    "dashboard.update": "src/server/application/capabilities/workspace-tools.ts:269",
    "dashboard.delete": "src/server/application/capabilities/workspace-tools.ts:270",
    "dashboard.widgets.list": "src/server/application/capabilities/legacy/project-tools.ts:473",
    "dashboard.widgets.create": "src/server/application/capabilities/legacy/project-tools.ts:493",
    "dashboard.widgets.update": "src/server/application/capabilities/legacy/project-tools.ts:513",
    "dashboard.widgets.delete": "src/server/application/capabilities/legacy/project-tools.ts:527",
    "dashboard.widgets.data": "src/server/application/capabilities/legacy/project-tools.ts:543",
    "portfolio.list": "src/server/application/capabilities/workspace-tools.ts:205",
    "portfolio.get": "src/server/application/capabilities/workspace-tools.ts:206",
    "portfolio.create": "src/server/application/capabilities/workspace-tools.ts:208",
    "portfolio.update": "src/server/application/capabilities/workspace-tools.ts:209",
    "portfolio.delete": "src/server/application/capabilities/workspace-tools.ts:210",
    "portfolio.addProject": "src/server/application/capabilities/legacy/project-tools.ts:608",
    "portfolio.removeProject": "src/server/application/capabilities/legacy/project-tools.ts:617",
    "portfolio.summary": "src/server/application/capabilities/workspace-tools.ts:207",
    "customField.definitions": "src/server/application/capabilities/legacy/project-tools.ts:641",
    "customField.create": "src/server/application/capabilities/legacy/project-tools.ts:657",
    "customField.update": "src/server/application/capabilities/legacy/project-tools.ts:669",
    "customField.archive": "src/server/application/capabilities/legacy/project-tools.ts:682",
    "project.report": "src/server/application/capabilities/legacy/project-tools.ts:697",
    "project.exportCsv": "src/server/application/capabilities/legacy/project-tools.ts:723",
    "integration.list": "src/server/application/capabilities/legacy/project-tools.ts:736",
    "integration.create": "src/server/application/capabilities/legacy/project-tools.ts:752",
    "integration.update": "src/server/application/capabilities/legacy/project-tools.ts:763",
    "integration.delete": "src/server/application/capabilities/legacy/project-tools.ts:776",
    "integration.syncStatus": "src/server/application/capabilities/legacy/project-tools.ts:789",
    "integration.sync": "src/server/application/capabilities/legacy/project-tools.ts:801",
    "webhook.list": "src/server/application/capabilities/legacy/project-tools.ts:813",
    "webhook.create": "src/server/application/capabilities/legacy/project-tools.ts:827",
    "webhook.update": "src/server/application/capabilities/legacy/project-tools.ts:839",
    "webhook.delete": "src/server/application/capabilities/legacy/project-tools.ts:852",
    "webhook.deliveries": "src/server/application/capabilities/legacy/project-tools.ts:871",
    "webhook.replay": "src/server/application/capabilities/legacy/project-tools.ts:885",
    "plan.completeIteration": "src/server/application/capabilities/legacy/work-planning-tools.ts:160",
    "plan.completeRelease": "src/server/application/capabilities/legacy/work-planning-tools.ts:163",
    "workitem.children": "src/server/application/capabilities/legacy/work-planning-tools.ts:174",
    "workitem.transfers": "src/server/application/capabilities/legacy/work-planning-tools.ts:192",
    "workitem.relations": "src/server/application/capabilities/legacy/work-planning-tools.ts:222",
    "workitem.unlink": "src/server/application/capabilities/legacy/work-planning-tools.ts:230",
    "plan.listModules": "src/server/application/capabilities/legacy/work-planning-tools.ts:247",
    "plan.iterationCapacity": "src/server/application/capabilities/legacy/work-planning-tools.ts:258",
    "plan.setIterationCapacity": "src/server/application/capabilities/legacy/work-planning-tools.ts:273",
    "savedView.get": "src/server/application/capabilities/workspace-tools.ts:247",
    "savedView.delete": "src/server/application/capabilities/workspace-tools.ts:256",
    "savedView.reorder": "src/server/application/capabilities/workspace-tools.ts:257",
    "workitem.progressUpdates": "src/server/application/capabilities/legacy/work-planning-tools.ts:342",
    "workitem.addProgressUpdate": "src/server/application/capabilities/legacy/work-planning-tools.ts:355",
    "workitem.deleteProgressUpdate": "src/server/application/capabilities/legacy/work-planning-tools.ts:368",
    "plan.milestoneDetail": "src/server/application/capabilities/legacy/work-planning-tools.ts:384",
    "plan.milestoneProgressUpdates": "src/server/application/capabilities/legacy/work-planning-tools.ts:393",
    "plan.addMilestoneProgressUpdate": "src/server/application/capabilities/legacy/work-planning-tools.ts:405",
    "plan.deleteMilestoneProgressUpdate": "src/server/application/capabilities/legacy/work-planning-tools.ts:418",
    "organization.get": "src/server/application/capabilities/organization-tools.ts:67",
    "organization.update": "src/server/application/capabilities/organization-tools.ts:69",
    "organization.getTemplate": "src/server/application/capabilities/organization-tools.ts:71",
    "department.list": "src/server/application/capabilities/organization-tools.ts:75",
    "department.create": "src/server/application/capabilities/organization-tools.ts:77",
    "department.update": "src/server/application/capabilities/organization-tools.ts:79",
    "department.archive": "src/server/application/capabilities/organization-tools.ts:81",
    "position.list": "src/server/application/capabilities/organization-tools.ts:83",
    "position.create": "src/server/application/capabilities/organization-tools.ts:85",
    "position.update": "src/server/application/capabilities/organization-tools.ts:87",
    "position.archive": "src/server/application/capabilities/organization-tools.ts:89",
    "member.get": "src/server/application/capabilities/organization-tools.ts:100",
    "member.getPermissions": "src/server/application/capabilities/organization-tools.ts:101",
    "member.assignOrganization": "src/server/application/capabilities/organization-tools.ts:103",
    "member.disable": "src/server/application/capabilities/organization-tools.ts:104",
    "member.enable": "src/server/application/capabilities/organization-tools.ts:105",
    "member.anonymize": "src/server/application/capabilities/organization-tools.ts:106",
    "role.listPermissions": "src/server/application/capabilities/organization-tools.ts:109",
    "role.listScopes": "src/server/application/capabilities/organization-tools.ts:110",
    "role.listAssignments": "src/server/application/capabilities/organization-tools.ts:117",
    "role.createAssignment": "src/server/application/capabilities/organization-tools.ts:119",
    "role.deleteAssignment": "src/server/application/capabilities/organization-tools.ts:123",
    "rag.conversation.action": "src/server/application/capabilities/rag-conversation-tools.ts:18",
    "rag.conversation.list": "src/server/application/capabilities/rag-conversation-tools.ts:19",
    "rag.conversation.get": "src/server/application/capabilities/rag-conversation-tools.ts:20",
    "rag.conversation.create": "src/server/application/capabilities/rag-conversation-tools.ts:21",
    "rag.conversation.update": "src/server/application/capabilities/rag-conversation-tools.ts:22",
    "rag.conversation.send": "src/server/application/capabilities/rag-conversation-tools.ts:23",
    "rag.conversation.cancel": "src/server/application/capabilities/rag-conversation-tools.ts:24",
    "rag.projects": "src/server/application/capabilities/rag-tools.ts:15",
    "rag.search": "src/server/application/capabilities/rag-tools.ts:16",
    "rag.chat": "src/server/application/capabilities/rag-tools.ts:17",
    "ping": "src/server/application/capabilities/tools.ts:103",
    "collab.inspect": "src/server/application/capabilities/tools.ts:114",
    "whoami": "src/server/application/capabilities/tools.ts:146",
    "project.list": "src/server/application/capabilities/tools.ts:170",
    "project.get": "src/server/application/capabilities/tools.ts:183",
    "project.members": "src/server/application/capabilities/tools.ts:194",
    "workitem.list": "src/server/application/capabilities/tools.ts:219",
    "workitem.get": "src/server/application/capabilities/tools.ts:241",
    "workitem.comments": "src/server/application/capabilities/tools.ts:256",
    "plan.listMilestones": "src/server/application/capabilities/tools.ts:273",
    "plan.getMilestone": "src/server/application/capabilities/legacy/work-planning-tools.ts:dynamic-milestone",
    "plan.listIterations": "src/server/application/capabilities/tools.ts:304",
    "plan.listReleases": "src/server/application/capabilities/tools.ts:315",
    "notification.list": "src/server/application/capabilities/tools.ts:326",
    "activity.project": "src/server/application/capabilities/tools.ts:346",
    "meta.workflow": "src/server/application/capabilities/tools.ts:363",
    "page.list": "src/server/application/capabilities/tools.ts:374",
    "page.get": "src/server/application/capabilities/tools.ts:385",
    "knowledge.search": "src/server/application/capabilities/tools.ts:401",
    "knowledge.ask": "src/server/application/capabilities/tools.ts:417",
    "meta.fields": "src/server/application/capabilities/tools.ts:428",
    "sla.get": "src/server/application/capabilities/tools.ts:435",
    "approval.list": "src/server/application/capabilities/tools.ts:446",
    "automation.listRules": "src/server/application/capabilities/tools.ts:457",
    "automation.listRuns": "src/server/application/capabilities/tools.ts:467",
    "intake.rotateToken": "src/server/application/capabilities/workspace-tools.ts:216",
    "focus.listBlocks": "src/server/application/capabilities/workspace-tools.ts:227",
    "focus.listSessions": "src/server/application/capabilities/workspace-tools.ts:238",
    "savedView.list": "src/server/application/capabilities/workspace-tools.ts:242",
    "savedView.create": "src/server/application/capabilities/workspace-tools.ts:248",
    "savedView.update": "src/server/application/capabilities/workspace-tools.ts:252",
    "dashboard.listWidgets": "src/server/application/capabilities/workspace-tools.ts:271",
    "dashboard.addWidget": "src/server/application/capabilities/workspace-tools.ts:276",
    "dashboard.updateWidget": "src/server/application/capabilities/workspace-tools.ts:280",
    "dashboard.deleteWidget": "src/server/application/capabilities/workspace-tools.ts:285",
    "dashboard.widgetData": "src/server/application/capabilities/workspace-tools.ts:286",
    "insight.burndown": "src/server/application/capabilities/workspace-tools.ts:290",
    "insight.activitySeries": "src/server/application/capabilities/workspace-tools.ts:292",
    "collab.command": "src/server/application/capabilities/write-tools.ts:87",
    "collab.update": "src/server/application/capabilities/write-tools.ts:122",
    "collab.publishPage": "src/server/application/capabilities/write-tools.ts:144",
    "workitem.create": "src/server/application/capabilities/write-tools.ts:172",
    "workitem.update": "src/server/application/capabilities/write-tools.ts:196",
    "workitem.transition": "src/server/application/capabilities/write-tools.ts:217",
    "workitem.assign": "src/server/application/capabilities/write-tools.ts:236",
    "workitem.comment": "src/server/application/capabilities/write-tools.ts:254",
    "workitem.link": "src/server/application/capabilities/write-tools.ts:276",
    "comment.update": "src/server/application/capabilities/write-tools.ts:288",
    "comment.delete": "src/server/application/capabilities/write-tools.ts:295",
    "idea.submit": "src/server/application/capabilities/write-tools.ts:310",
    "idea.vote": "src/server/application/capabilities/write-tools.ts:327",
    "idea.promote": "src/server/application/capabilities/write-tools.ts:343",
    "page.create": "src/server/application/capabilities/write-tools.ts:363",
    "page.update": "src/server/application/capabilities/write-tools.ts:380",
    "plan.createMilestone": "src/server/application/capabilities/write-tools.ts:415",
    "plan.createIteration": "src/server/application/capabilities/write-tools.ts:434",
    "plan.createRelease": "src/server/application/capabilities/write-tools.ts:450",
    "plan.createModule": "src/server/application/capabilities/write-tools.ts:466",
    "notification.markRead": "src/server/application/capabilities/write-tools.ts:485",
    "notification.setPrefs": "src/server/application/capabilities/write-tools.ts:514",
    "announcement.send": "src/server/application/capabilities/write-tools.ts:554",
    "announcement.revoke": "src/server/application/capabilities/write-tools.ts:566",
    "sla.pause": "src/server/application/capabilities/write-tools.ts:573",
    "sla.resume": "src/server/application/capabilities/write-tools.ts:584",
    "approval.approve": "src/server/application/capabilities/write-tools.ts:595",
    "approval.reject": "src/server/application/capabilities/write-tools.ts:606",
    "automation.createRule": "src/server/application/capabilities/write-tools.ts:617",
    "plan.updateMilestone": "src/server/application/capabilities/legacy/work-planning-tools.ts:dynamic-milestone",
    "plan.archiveMilestone": "src/server/application/capabilities/legacy/work-planning-tools.ts:dynamic-milestone",
    "plan.unarchiveMilestone": "src/server/application/capabilities/legacy/work-planning-tools.ts:dynamic-milestone",
    "plan.getIteration": "src/server/application/capabilities/legacy/work-planning-tools.ts:dynamic-iteration",
    "plan.updateIteration": "src/server/application/capabilities/legacy/work-planning-tools.ts:dynamic-iteration",
    "plan.archiveIteration": "src/server/application/capabilities/legacy/work-planning-tools.ts:dynamic-iteration",
    "plan.unarchiveIteration": "src/server/application/capabilities/legacy/work-planning-tools.ts:dynamic-iteration",
    "plan.getRelease": "src/server/application/capabilities/legacy/work-planning-tools.ts:dynamic-release",
    "plan.updateRelease": "src/server/application/capabilities/legacy/work-planning-tools.ts:dynamic-release",
    "plan.archiveRelease": "src/server/application/capabilities/legacy/work-planning-tools.ts:dynamic-release",
    "plan.unarchiveRelease": "src/server/application/capabilities/legacy/work-planning-tools.ts:dynamic-release",
    "plan.getModule": "src/server/application/capabilities/legacy/work-planning-tools.ts:dynamic-module",
    "plan.updateModule": "src/server/application/capabilities/legacy/work-planning-tools.ts:dynamic-module",
    "plan.archiveModule": "src/server/application/capabilities/legacy/work-planning-tools.ts:dynamic-module",
    "plan.unarchiveModule": "src/server/application/capabilities/legacy/work-planning-tools.ts:dynamic-module"
  }
};
