dim a as String
dim b as Integer
dim lastElementID as String = ""
dim wasLayoutEdited as Boolean = false
dim editStatus as Integer = 0

sub OnInit()
    for i = 0 to 19
        reorder_clear(i)
    next
end sub

sub print_order(boxType as Integer)
    dim c as Container
    dim i as Integer
    c = Scene.FindContainer("BOX_LAYOUTS").GetChildContainerByIndex(boxType)
    if not c.Valid then
        exit sub
    end if
    println "===== ORDER ====="
    for i = 0 to c.ChildContainerCount - 1
        println CStr(i) & " = " & c.GetChildContainerByIndex(i).Name
    next
end sub

sub apply_layout_live(boxType as Integer, boxData as String)
    println "===== APPLY LAYOUT ====="
    println "BOX TYPE = " & CStr(boxType)
    println "BOX DATA = " & boxData
    reorder_edited_fast(boxType, boxData)
    b = boxType
    println "===== REORDER DONE - WAIT EXECTION ====="
    Scene.FindContainer("BOX_LAYOUTS").ScriptPluginInstance.SetParameterInt("idxLayout", b)
    Scene.FindContainer("BOX_LAYOUTS").ScriptPluginInstance.Script.Execute()
    Scene.UpdateSceneTree()
end sub

sub apply_layout_live_swap(boxType as Integer, boxData as String)
    println "===== APPLY LAYOUT ====="
    println "BOX TYPE = " & CStr(boxType)
    println "BOX DATA = " & boxData
    reorder_edited_fast(boxType, boxData)
    b = boxType
    println "===== apply_layout_live_swap ====="
    'Stage.FindDirector("SWITCHER").StartAnimation()
end sub

sub finish_layout_edit()
    if editStatus = 2 then
        println "===== FINISH LAYOUT EDIT ====="
        println "BOX TYPE = " & CStr(b)
        Scene.FindContainer("BOX_LAYOUTS").ScriptPluginInstance.SetParameterInt("idxLayout", b)
        Scene.FindContainer("BOX_LAYOUTS").ScriptPluginInstance.Script.Execute2()
        Scene.UpdateSceneTree()
        println "===== EDITED FINAL ====="
    end if
end sub

sub exec_msg_layout_edited_swap()
    dim bundle as Array[String]
    dim boxType as Integer
    dim boxData as String

    if editStatus <> 2 then
        println "===== SWAP SKIP ====="
        println "STATUS = " & CStr(editStatus)
        exit sub
    end if

    if a = "" then
        println "===== NO SWAP DATA - SKIP ====="
        exit sub
    end if

    println "===== EXEC SWAP ====="
    println "STATUS = " & CStr(editStatus)
    println "DATA = " & a

    a.Split("|", bundle)
    if bundle.Size <> 2 then
        println "INVALID SWAP DATA"
        exit sub
    end if

    boxType = CInt(bundle[0])
    boxData = bundle[1]

    apply_layout_live_swap(boxType, boxData)

    a = ""
end sub

sub exec_msg_layout_edited()
    dim bundle as Array[String]
    dim boxType as Integer
    dim boxData as String

    if a = "" then
        println "===== NO EDITED DATA - SKIP ====="
        exit sub
    end if

    println "===== EXEC EDITED ====="
    println "DATA = " & a

    a.Split("|", bundle)
    if bundle.Size <> 2 then
        println "INVALID EDITED DATA"
        exit sub
    end if

    boxType = CInt(bundle[0])
    boxData = bundle[1]

    apply_layout_live(boxType, boxData)

    a = ""
end sub

sub msg_layout_edited_swap(dataLayout as String)
    editStatus = 2
    wasLayoutEdited = true
    a = dataLayout
    println "===== HTML SWAP RECEIVED ====="
    println "STATUS = SWAP"
    println "A SAVED = " & a
    exec_msg_layout_edited_swap()
end sub

sub msg_layout_edited(dataLayout as String)
    editStatus = 1
    wasLayoutEdited = true
    a = dataLayout
    println "===== HTML EDITED RECEIVED ====="
    println "A SAVED = " & a
    exec_msg_layout_edited()
end sub

sub reorder_edited_fast(boxType as Integer, boxData as String)
    dim c as Container
    dim box as Container
    dim items as Array[String]
    dim pair as Array[String]
    dim ordered as Array[Container]
    dim usedNames as Array[String]
    dim i as Integer
    dim j as Integer
    dim targetIndex as Integer
    dim boxName as String
    dim isUsed as Boolean

    println "===== REORDER EDITED FAST ====="
    println "BOX TYPE = " & CStr(boxType)
    println "BOX DATA = " & boxData

    c = Scene.FindContainer("BOX_LAYOUTS").GetChildContainerByIndex(boxType)
    if not c.Valid then
        println "INVALID LAYOUT"
        exit sub
    end if

    for i = 0 to c.ChildContainerCount - 1
        ordered.Push(c)
    next

    boxData.Split(",", items)
    for i = 0 to items.Size - 1
        pair.Clear()
        items[i].Split(":", pair)
        if pair.Size = 2 then
            boxName = pair[0]
            targetIndex = CInt(pair[1])
            box = c.FindSubContainer(boxName)
            if box.Valid then
                if targetIndex >= 0 and targetIndex < ordered.Size then
                    ordered[targetIndex] = box
                    usedNames.Push(boxName)
                    println "TARGET " & CStr(targetIndex) & " = " & boxName
                end if
            end if
        end if
    next

    for i = 0 to c.ChildContainerCount - 1
        box = c.GetChildContainerByIndex(i)
        isUsed = false
        for j = 0 to usedNames.Size - 1
            if box.Name = usedNames[j] then
                isUsed = true
                exit for
            end if
        next

        if not isUsed then
            for j = 0 to ordered.Size - 1
                if ordered[j] = c then
                    ordered[j] = box
                    println "FILL " & CStr(j) & " = " & box.Name
                    exit for
                end if
            next
        end if
    next

    ' APPLY FINAL ORDER: BOTTOM -> TOP
    for i = ordered.ubound to 0 step -1
        box = ordered[i]
        println "MOVE " & box.Name & " -> " & CStr(i)
        box.MoveTo(c, TL_DOWN)
    next

    Scene.UpdateSceneTree()

    println "===== REORDER EDITED FAST DONE ====="
    print_order(boxType)
end sub

sub msg_director_take(data as String)
editStatus = 1
    dim parts as Array[String]
    dim elementID as String
    dim boxType as Integer

    println "RAW = " & data

    data.Split("|", parts)

    if parts.Size <> 2 then
        println "INVALID DATA"
        exit sub
    end if

    elementID = parts[0]
    boxType = CInt(parts[1])

    println "ELEMENT ID = " & elementID
    println "LAST ELEMENT ID = " & lastElementID
    println "BOX TYPE = " & CStr(boxType)
    println "WAS EDITED = " & CStr(wasLayoutEdited)


    ' SAME ELEMENT
    if elementID = lastElementID then

        println "SAME ELEMENT"

        reorder_clear_same_element(boxType)

        wasLayoutEdited = false

        'exit sub

    end if


    ' NEW ELEMENT AFTER EDIT
    if wasLayoutEdited then

        println "NEW ELEMENT AFTER EDIT"

        lastElementID = elementID

        reorder_clear_same_element(boxType)

        wasLayoutEdited = false

        exit sub

    end if


    ' NEW ELEMENT NORMAL
    println "NEW ELEMENT NORMAL"

    lastElementID = elementID

    reorder_clear(boxType)

end sub

sub reorder_clear_same_element(boxType as Integer)
    dim c as Container
    dim box as Container
    dim i as Integer
    dim boxName as String

    println "===== REORDER CLEAR ====="
    println "BOX TYPE = " & CStr(boxType)

    c = Scene.FindContainer("BOX_LAYOUTS").GetChildContainerByIndex(boxType)
    if not c.Valid then
        println "INVALID LAYOUT INDEX = " & CStr(boxType)
        exit sub
    end if

    ' Restore BOX_01 ... BOX_12 order
    for i = 12 to 1 step -1
        if i < 10 then
            boxName = "BOX_0" & CStr(i)
        else
            boxName = "BOX_" & CStr(i)
        end if
        box = c.FindSubContainer(boxName)
        if box.Valid then
            println "ORDER " & boxName
            box.MoveTo(c, TL_DOWN)
        end if
    next

    Scene.FindContainer("BOX_LAYOUTS").ScriptPluginInstance.SetParameterInt("idxLayout", boxType)
    Scene.FindContainer("BOX_LAYOUTS").ScriptPluginInstance.Script.Execute()
    Scene.UpdateSceneTree()

    println "===== REORDER CLEAR DONE ====="
    print_order(boxType)
end sub

sub reorder_clear(boxType as Integer)
    dim c as Container
    dim box as Container
    dim i as Integer
    dim boxName as String

    println "===== REORDER CLEAR ====="
    println "BOX TYPE = " & CStr(boxType)

    c = Scene.FindContainer("BOX_LAYOUTS").GetChildContainerByIndex(boxType)
    if not c.Valid then
        println "INVALID LAYOUT INDEX = " & CStr(boxType)
        exit sub
    end if

    ' Restore BOX_01 ... BOX_12 order
    for i = 12 to 1 step -1
        if i < 10 then
            boxName = "BOX_0" & CStr(i)
        else
            boxName = "BOX_" & CStr(i)
        end if
        box = c.FindSubContainer(boxName)
        if box.Valid then
            println "ORDER " & boxName
            box.MoveTo(c, TL_DOWN)
        end if
    next

    Scene.FindContainer("BOX_LAYOUTS").ScriptPluginInstance.SetParameterInt("idxLayout", boxType)
    'check element
    'Scene.FindContainer("BOX_LAYOUTS").ScriptPluginInstance.Script.Execute()
    Scene.UpdateSceneTree()

    println "===== REORDER CLEAR DONE ====="
    print_order(boxType)
end sub

sub OnInitParameters()
    RegisterPushButton("reset", "RESET DEFAULT", 0)
    RegisterPushButton("edited", "EDITED RELAYOUT", 1)
    RegisterPushButton("exec", "EXECUTE", 2)
end sub

sub OnExecAction(buttonId As Integer)
    if buttonId = 0 then
        OnInit()
        'reorder_clear(1)
    elseif buttonId = 1 then
        'exec_msg_layout_edited()
        finish_layout_edit()
    elseif buttonId = 2 then
        println "AAA"
        msg_layout_edited("3|BOX_01:0,BOX_02:1,BOX_03:3")
    end if
end sub
