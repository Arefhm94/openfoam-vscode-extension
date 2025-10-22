import math as m
import Rhino
import rhinoscriptsyntax as rs
from System.Drawing import Color
import os
import System.Guid
import scriptcontext as sr
import random
import struct as st

list_of_files = os.listdir('./')

def is_binary(filename):
    """
    Return true if the given filename appears to be binary.
    File is considered to be binary if it contains a NULL byte.
    FIXME: This approach incorrectly reports UTF-16 as binary.
    """
    if filename.split('.')[-1] != 'stl':
        return
    with open(filename, 'rb') as f:
        for block in f:
            if '\0' in block:
                return True
    return False

normals = []
points = []
triangles = []
bytecount = []


def unpack(f, sig, l):
    s = f.read(l)
    return st.unpack(sig, s)

def read_triangle(f):
    n = unpack(f,"<3f", 12)
    p1 = unpack(f,"<3f", 12)
    p2 = unpack(f,"<3f", 12)
    p3 = unpack(f,"<3f", 12)
    b = unpack(f,"<h", 2)

    normals.append(n)
    l = len(points)
    points.append(p1)
    points.append(p2)
    points.append(p3)
    triangles.append((l, l+1, l+2))
    bytecount.append(b[0])


def read_length(f):
    length = st.unpack("@i", f.read(4))
    return length[0]

def read_header(f):
    f.seek(f.tell()+80)


def meshAdder(file_):
    temp_mesh = Rhino.Geometry.Mesh(); MESH = Rhino.Geometry.Mesh()
    layer = 0; color  = 0;
    if file_.split('.')[-1] != 'stl':
        return
    with open(file_) as f:
       for line in f:
            
            if "vertex" in line:
                q = line.replace("vertex","")
                q = q.replace("\n","")
                q = [float(x) for x in q.split()]
                temp_mesh.Vertices.Add(q[0],q[1],q[2])
                
            if "endloop" in line:
                temp_mesh.Faces.AddFace(0,1,2)
                MESH.Append(temp_mesh)
                temp_mesh = Rhino.Geometry.Mesh()

    rs.AddLayer (name=file_, color=[random.randint(1,254),random.randint(1,254),random.randint(1,254)], visible=True, locked=False, parent=None)
    rs.CurrentLayer (layer=file_)
    MESH.Normals.ComputeNormals()
    MESH.Compact()
    sr.doc.Objects.AddMesh(MESH)

def meshBinaryAdder(file_):
    f = open(file_, "rb")
    read_header(f)
    l = read_length(f)
    try:
        while True:
            read_triangle(f)
    except:
        print 
    temp_mesh = Rhino.Geometry.Mesh(); MESH = Rhino.Geometry.Mesh()
    layer = 0; color  = 0;
    if file_.split('.')[-1] != 'stl':
        return
    for n in range(len(triangles)):
        temp_mesh.Vertices.Add(points[triangles[n][0]][0],points[triangles[n][0]][1],points[triangles[n][0]][2])
        temp_mesh.Faces.AddFace(0,1,2)
        MESH.Append(temp_mesh)
        temp_mesh.Vertices.Add(points[triangles[n][1]][0],points[triangles[n][1]][1],points[triangles[n][1]][2])
        temp_mesh.Faces.AddFace(0,1,2)
        MESH.Append(temp_mesh)
        temp_mesh.Vertices.Add(points[triangles[n][2]][0],points[triangles[n][2]][1],points[triangles[n][2]][2])
        temp_mesh.Faces.AddFace(0,1,2)
        MESH.Append(temp_mesh)
        temp_mesh = Rhino.Geometry.Mesh()

    rs.AddLayer(name=file_, color=[random.randint(1,254),random.randint(1,254),random.randint(1,254)], visible=True, locked=False, parent=None)
    rs.CurrentLayer (layer=file_)
    MESH.Normals.ComputeNormals()
    MESH.Compact()
    sr.doc.Objects.AddMesh(MESH)
    


for i in range(len(list_of_files)):
    if is_binary(list_of_files[i]):
        print "Binary file: " +list_of_files[i]
        meshBinaryAdder(list_of_files[i])
        normals = [];points = [];triangles = [];bytecount = []
    else:
        meshAdder(list_of_files[i])
        
sr.doc.Views.Redraw()
